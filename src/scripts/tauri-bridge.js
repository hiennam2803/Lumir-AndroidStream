/* Cầu nối Tauri ⇄ UI. Toàn bộ UI vẫn chạy được trong trình duyệt thường (không có __TAURI__). */
(function(){
 const T=window.__TAURI__;
 if(!T||!T.window)return;
 const root=document.documentElement;
 root.classList.add("tauri");

 document.addEventListener("DOMContentLoaded",function(){
  const win=T.window.getCurrentWindow();
  const fail=function(e){console.error("[LUMIR] window api:",e);if(typeof toast==="function")toast("Window action failed")};
  const head=document.querySelector("header");
  if(!head)return;
  const skip=function(e){return e.target.closest("button,.seg,.sys,select,input")};

  /* Header tự vẽ (decorations:false): kéo bằng vùng trống, nhấp đúp để phóng to/thu lại */
  head.addEventListener("mousedown",function(e){
   if(e.button!==0||e.detail>1||skip(e))return;
   win.startDragging().catch(fail);
  });
  head.addEventListener("dblclick",function(e){
   if(skip(e))return;
   win.toggleMaximize().catch(fail);
  });

  /* Thiết kế mới không có nút cửa sổ: thêm Thu nhỏ / Phóng to / Đóng vào cuối .hr */
  const hr=head.querySelector(".hr");
  if(hr){
   const mk=function(cls,title,path,fn){
    const b=document.createElement("button");
    b.className="btn ico ghost "+cls;b.title=title;b.setAttribute("aria-label",title);
    b.innerHTML='<svg viewBox="0 0 24 24"><path d="'+path+'"/></svg>';
    b.addEventListener("click",function(){fn().catch(fail)});
    hr.appendChild(b);
   };
   const sep=document.createElement("span");sep.className="wsep";hr.appendChild(sep);
   mk("wc-min","Minimize","M5 12h14",function(){return win.minimize()});
   mk("wc-max","Maximize","M5 5h14v14H5z",function(){return win.toggleMaximize()});
   mk("wc-x","Close","M6 6l12 12M18 6L6 18",function(){return win.close()});
  }

  /* Khi phóng to: bỏ bo góc để không lộ góc trong suốt */
  const sync=function(){win.isMaximized().then(function(m){root.classList.toggle("max",m)}).catch(function(){})};
  win.onResized(sync).catch(function(){});sync();

  /* Cảm giác app desktop: tắt menu chuột phải mặc định của WebView (F12 vẫn mở devtools khi dev) */
  document.addEventListener("contextmenu",function(e){e.preventDefault()});
 });
})();
