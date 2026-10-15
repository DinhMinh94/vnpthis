// =========================================================================
// VNPT HMIS 4.0 - Auto Login Helper Content Script
// Tự động điền tài khoản & mật khẩu khi mở từ bảng cấu hình Trạm Y Tế
// =========================================================================

(function () {
  console.log('[VNPT HMIS AutoLogin] Content script loaded on:', window.location.href);

  function showHelperToast(msg, isSuccess = true) {
    const existing = document.getElementById('hmis-autologin-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'hmis-autologin-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999999;
      background: ${isSuccess ? 'linear-gradient(135deg, #059669, #0d9488)' : 'linear-gradient(135deg, #e11d48, #be123c)'};
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
      animation: hmisSlideDown 0.3s ease-out;
    `;

    toast.innerHTML = `
      <span style="font-size: 16px;">⚡</span>
      <span>${msg}</span>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  function executeAutoLogin() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('autologin=')) return;

    try {
      const b64Part = hash.split('autologin=')[1].split('&')[0];
      if (!b64Part) return;

      const jsonStr = decodeURIComponent(escape(atob(b64Part)));
      const data = JSON.parse(jsonStr);

      if (!data || !data.u) return;

      console.log('[VNPT HMIS AutoLogin] Nhận yêu cầu tự động điền tài khoản:', data.u);

      let attempts = 0;
      const maxAttempts = 60; // Thử trong 12 giây cho Single-SPA mount form

      const timer = setInterval(() => {
        attempts++;

        const userInput = document.querySelector('input[formcontrolname="userName"]')
                       || document.querySelector('input[autocomplete="username"]')
                       || document.querySelector('#loginForm input[type="text"]')
                       || document.querySelector('input[type="text"]');

        const passInput = document.querySelector('input[formcontrolname="password"]')
                       || document.querySelector('input[autocomplete="current-password"]')
                       || document.querySelector('#loginForm input[type="password"]')
                       || document.querySelector('input[type="password"]');

        if (userInput && passInput) {
          clearInterval(timer);

          // 1. Điền tên đăng nhập
          userInput.focus();
          userInput.value = data.u;
          userInput.dispatchEvent(new Event('input', { bubbles: true }));
          userInput.dispatchEvent(new Event('change', { bubbles: true }));
          userInput.dispatchEvent(new Event('blur', { bubbles: true }));

          // 2. Điền mật khẩu
          if (data.p) {
            passInput.focus();
            passInput.value = data.p;
            passInput.dispatchEvent(new Event('input', { bubbles: true }));
            passInput.dispatchEvent(new Event('change', { bubbles: true }));
            passInput.dispatchEvent(new Event('blur', { bubbles: true }));
          }

          // 3. Xóa hash khỏi URL để giữ URL sạch và bảo mật thông tin
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, null, window.location.pathname + window.location.search);
          }

          showHelperToast(`Đã tự động điền tài khoản: ${data.u}`);

          // 4. Tự động click nút Đăng nhập sau 350ms
          setTimeout(() => {
            const loginBtn = document.querySelector('#loginForm button[type="submit"]')
                          || document.querySelector('button[type="submit"]')
                          || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Đăng nhập'));

            if (loginBtn && !loginBtn.disabled) {
              console.log('[VNPT HMIS AutoLogin] Bấm nút Đăng nhập...');
              loginBtn.click();
            }
          }, 350);
        }

        if (attempts >= maxAttempts) {
          clearInterval(timer);
          console.warn('[VNPT HMIS AutoLogin] Quá thời gian chờ form đăng nhập mount.');
        }
      }, 200);

    } catch (err) {
      console.error('[VNPT HMIS AutoLogin] Lỗi giải mã tham số autologin:', err);
    }
  }

  // Khởi động AutoLogin
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', executeAutoLogin);
  } else {
    executeAutoLogin();
  }

  window.addEventListener('hashchange', executeAutoLogin);

  // =========================================================================
  // BỘ TỰ ĐỘNG BẮT API PHIẾU IN BÁO CÁO KHI TRUY CẬP GIAO DIỆN HMIS
  // =========================================================================
  try {
    const snifferCode = `
      (function() {
        // Sniff fetch
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
          if (url && (url.includes('/api/') || url.includes('-gw.hmis.vn'))) {
            if (url.includes('baocao') || url.includes('phieuin') || url.includes('template') || window.location.href.includes('phieuin-baocao')) {
              window.postMessage({ type: 'HMIS_API_DETECTED', url: url, method: (args[1] && args[1].method) || 'GET' }, '*');
            } else if (url.includes('signtitle') || url.includes('chucdanh') || window.location.href.includes('chucdanh-kyso')) {
              window.postMessage({ type: 'HMIS_CHUCDANH_API_DETECTED', url: url, method: (args[1] && args[1].method) || 'GET' }, '*');
            }
          }
          return origFetch.apply(this, args);
        };

        // Sniff XMLHttpRequest
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          this._url = url;
          this._method = method;
          return origOpen.apply(this, arguments);
        };

        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function() {
          if (this._url && (this._url.includes('/api/') || this._url.includes('-gw.hmis.vn'))) {
            if (this._url.includes('baocao') || this._url.includes('phieuin') || this._url.includes('template') || window.location.href.includes('phieuin-baocao')) {
              window.postMessage({ type: 'HMIS_API_DETECTED', url: this._url, method: this._method || 'GET' }, '*');
            } else if (this._url.includes('signtitle') || this._url.includes('chucdanh') || window.location.href.includes('chucdanh-kyso')) {
              window.postMessage({ type: 'HMIS_CHUCDANH_API_DETECTED', url: this._url, method: this._method || 'GET' }, '*');
            }
          }
          return origSend.apply(this, arguments);
        };
      })();
    `;

    const scriptEl = document.createElement('script');
    scriptEl.textContent = snifferCode;
    (document.head || document.documentElement).appendChild(scriptEl);
    scriptEl.remove();

    let lastDetectedUrl = '';
    window.addEventListener('message', async (event) => {
      if (event.data && event.data.type === 'HMIS_API_DETECTED') {
        const detectedUrl = event.data.url;
        if (detectedUrl === lastDetectedUrl) return;
        lastDetectedUrl = detectedUrl;
        console.log('[VNPT HMIS Extension] ⚡ Bắt được request API Phiếu In:', detectedUrl);

        showHelperToast(`⚡ Đã bắt API Phiếu In: ${detectedUrl.split('?')[0].split('/').slice(-2).join('/')}`, true);

        try {
          await fetch('http://localhost:5000/api/phieuin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullUrl: detectedUrl })
          });
          console.log('[VNPT HMIS Extension] Đã tự động đồng bộ API về tool localhost:5000');
        } catch (postErr) {}
      } else if (event.data && event.data.type === 'HMIS_CHUCDANH_API_DETECTED') {
        const detectedUrl = event.data.url;
        if (detectedUrl === lastDetectedUrl) return;
        lastDetectedUrl = detectedUrl;
        console.log('[VNPT HMIS Extension] ⚡ Bắt được request API Chức Danh Ký Số:', detectedUrl);

        showHelperToast(`⚡ Đã bắt API Chức Danh Ký Số: ${detectedUrl.split('?')[0].split('/').slice(-2).join('/')}`, true);

        try {
          await fetch('http://localhost:5000/api/chucdanh/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullUrl: detectedUrl })
          });
          console.log('[VNPT HMIS Extension] Đã đồng bộ API Chức Danh Ký Số về tool localhost:5000');
        } catch (postErr) {}
      }
    });
  } catch (snifferErr) {
    console.warn('[VNPT HMIS Extension] Không thể kích hoạt bộ bắt API:', snifferErr);
  }
})();
