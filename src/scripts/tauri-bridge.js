/* Cầu nối Tauri ⇄ UI. Toàn bộ UI vẫn chạy được trong trình duyệt thường (không có __TAURI__). */
(function(){
 const T=window.__TAURI__;
 if(!T||!T.window)return;
 document.documentElement.classList.add("tauri");

 document.addEventListener("DOMContentLoaded",function(){
  const win=T.window.getCurrentWindow();
  const fail=function(e){console.error("[LUMIR] window api:",e);if(typeof toast==="function")toast("Không thực hiện được thao tác cửa sổ")};

  /* Titlebar tự vẽ (decorations:false) → kéo cửa sổ bằng vùng trống của #title */
  document.getElementById("title").addEventListener("mousedown",function(e){
   if(e.button!==0||e.target.closest("button,.conn"))return;
   win.startDragging().catch(fail);
  });

  /* Nút Thu nhỏ / Đóng: thay handler "không khả dụng trong bản web" bằng thao tác native */
  const [btnMin,btnClose]=document.querySelectorAll("#title .wb");
  btnMin.onclick=function(){win.minimize().catch(fail)};
  btnClose.onclick=function(){win.close().catch(fail)};

  /* Cảm giác app desktop: tắt menu chuột phải mặc định của WebView (F12 vẫn mở devtools khi dev) */
  document.addEventListener("contextmenu",function(e){e.preventDefault()});
 });
})();
