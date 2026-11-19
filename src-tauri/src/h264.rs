//! Tách luồng H.264 Annex-B (đầu ra của `screenrecord --output-format=h264`) thành NAL rồi ghép thành
//! "access unit" (một khung hình). Không phụ thuộc Tauri nên test được độc lập.
//!
//! Giả định (đúng với encoder phần cứng của MediaCodec): mỗi khung chỉ có MỘT slice (NAL loại 1 hoặc 5);
//! SPS/PPS/SEI đi trước slice IDR và được gộp chung vào khung đó.

/// Một khung hình hoàn chỉnh, còn nguyên start code (WebCodecs nhận trực tiếp định dạng Annex-B).
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub key: bool,
    pub data: Vec<u8>,
}

/// Cắt luồng byte thành các NAL (mỗi NAL bắt đầu bằng 00 00 01 hoặc 00 00 00 01).
#[derive(Default)]
pub struct NalSplitter {
    buf: Vec<u8>,
}

/// Vị trí start code đầu tiên trong `b[from..]`: (vị trí byte 0 của start code, độ dài 3 hoặc 4).
fn find_start(b: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut i = from;
    while i + 3 <= b.len() {
        if b[i] == 0 && b[i + 1] == 0 {
            if b[i + 2] == 1 {
                return Some((i, 3));
            }
            if b[i + 2] == 0 && i + 4 <= b.len() && b[i + 3] == 1 {
                return Some((i, 4));
            }
        }
        i += 1;
    }
    None
}

impl NalSplitter {
    /// Nạp thêm dữ liệu, trả về các NAL đã hoàn chỉnh (đã biết điểm kết thúc nhờ start code kế tiếp).
    pub fn push(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(data);
        let mut out = Vec::new();
        // Bỏ rác trước start code đầu tiên (nếu luồng bắt đầu giữa chừng).
        match find_start(&self.buf, 0) {
            Some((0, _)) => {}
            Some((p, _)) => {
                self.buf.drain(..p);
            }
            None => {
                // Giữ lại 3 byte cuối phòng start code bị cắt đôi giữa hai lần đọc.
                let keep = self.buf.len().saturating_sub(3);
                self.buf.drain(..keep);
                return out;
            }
        }
        loop {
            let Some((_, l0)) = find_start(&self.buf, 0) else { break };
            let Some((next, _)) = find_start(&self.buf, l0) else { break };
            out.push(self.buf.drain(..next).collect());
        }
        out
    }

    /// Lấy nốt NAL đang dở (dùng khi luồng im lặng: màn hình tĩnh nên khung cuối không có start code theo sau).
    pub fn flush(&mut self) -> Option<Vec<u8>> {
        match find_start(&self.buf, 0) {
            Some((0, l)) if self.buf.len() > l + 1 => Some(std::mem::take(&mut self.buf)),
            _ => None,
        }
    }

    /// Có NAL đang chờ không (để biết có cần đặt hạn chờ im lặng hay không).
    pub fn has_pending(&self) -> bool {
        matches!(find_start(&self.buf, 0), Some((0, l)) if self.buf.len() > l + 1)
    }
}

/// Loại NAL (5 bit thấp của byte sau start code).
pub fn nal_type(nal: &[u8]) -> Option<u8> {
    let (p, l) = find_start(nal, 0)?;
    nal.get(p + l).map(|b| b & 0x1f)
}

/// Ghép NAL thành khung: SPS(7)/PPS(8)/SEI(6)/AUD(9) chờ slice kế tiếp; slice 1..=5 hoàn tất một khung.
#[derive(Default)]
pub struct FrameBuilder {
    pending: Vec<u8>,
}

impl FrameBuilder {
    pub fn push(&mut self, nal: Vec<u8>) -> Option<Frame> {
        match nal_type(&nal)? {
            1..=5 => {
                let t = nal_type(&nal)?;
                let mut data = std::mem::take(&mut self.pending);
                data.extend_from_slice(&nal);
                Some(Frame { key: t == 5, data })
            }
            6..=9 => {
                self.pending.extend_from_slice(&nal);
                None
            }
            _ => None,
        }
    }
}

/// Kích thước `--size` cho screenrecord: cạnh dài ≤ `max_long`, mỗi cạnh làm tròn về bội số của 16
/// (nhiều encoder phần cứng chỉ nhận kích thước căn lề). Không phóng to màn hình nhỏ.
pub fn encode_size(w: u32, h: u32, max_long: u32) -> Option<(u32, u32)> {
    if w == 0 || h == 0 {
        return None;
    }
    let long = w.max(h);
    let scale = if long > max_long { max_long as f64 / long as f64 } else { 1.0 };
    let r = |v: u32| (((v as f64 * scale) / 16.0).round() as u32).max(1) * 16;
    Some((r(w), r(h)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPS: &[u8] = &[0, 0, 0, 1, 0x67, 0x64, 0, 0x2a, 0xac];
    const PPS: &[u8] = &[0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80];
    const IDR: &[u8] = &[0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00, 0x10];
    const P1: &[u8] = &[0, 0, 0, 1, 0x41, 0x9a, 0x02];
    const P2: &[u8] = &[0, 0, 1, 0x41, 0x9a, 0x03];

    fn stream() -> Vec<u8> {
        [SPS, PPS, IDR, P1, P2].concat()
    }

    #[test]
    fn splits_nals_in_one_chunk() {
        let mut s = NalSplitter::default();
        let nals = s.push(&stream());
        assert_eq!(nals.len(), 4, "NAL cuối chưa biết điểm kết thúc");
        assert_eq!(nals[0], SPS);
        assert_eq!(nals[2], IDR);
        assert_eq!(s.flush().unwrap(), P2);
        assert!(s.flush().is_none());
    }

    #[test]
    fn splits_across_arbitrary_chunk_boundaries() {
        let all = stream();
        for step in 1..=all.len() {
            let mut s = NalSplitter::default();
            let mut nals = Vec::new();
            for c in all.chunks(step) {
                nals.extend(s.push(c));
            }
            nals.extend(s.flush());
            assert_eq!(nals.concat(), all, "step={step}");
            assert_eq!(nals.len(), 5, "step={step}");
        }
    }

    #[test]
    fn skips_garbage_before_first_start_code() {
        let mut s = NalSplitter::default();
        let mut d = vec![0xde, 0xad, 0xbe];
        d.extend_from_slice(&stream());
        let mut nals = s.push(&d);
        nals.extend(s.flush());
        assert_eq!(nals.concat(), stream());
    }

    #[test]
    fn builds_frames() {
        let mut s = NalSplitter::default();
        let mut b = FrameBuilder::default();
        let mut nals = s.push(&stream());
        nals.extend(s.flush());
        let frames: Vec<Frame> = nals.into_iter().filter_map(|n| b.push(n)).collect();
        assert_eq!(frames.len(), 3);
        assert!(frames[0].key);
        assert_eq!(frames[0].data, [SPS, PPS, IDR].concat(), "SPS+PPS gộp vào khung IDR");
        assert!(!frames[1].key);
        assert_eq!(frames[1].data, P1);
        assert_eq!(frames[2].data, P2);
    }

    #[test]
    fn flush_needs_payload() {
        let mut s = NalSplitter::default();
        s.push(&[0, 0, 0, 1]);
        assert!(!s.has_pending());
        assert!(s.flush().is_none());
    }

    #[test]
    fn encode_size_rules() {
        assert_eq!(encode_size(1080, 2400, 1280), Some((576, 1280)));
        assert_eq!(encode_size(2400, 1080, 1280), Some((1280, 576)));
        assert_eq!(encode_size(720, 1280, 1280), Some((720, 1280)));
        assert_eq!(encode_size(480, 800, 1280), Some((480, 800)), "không phóng to");
        assert_eq!(encode_size(0, 800, 1280), None);
    }
}
