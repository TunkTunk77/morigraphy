/* =========================================================
   MoriGraphy — motion (GSAP)
   Theo skill motion-design: phong cách "Premium"
   - Easing chữ ký: cubic-bezier(0.4, 0, 0.2, 1) cho ~80% chuyển động
   - Bảng thời lượng: quick 0.2s · standard 0.45s · slow 0.8s
   - Vào = decelerate (ease-out), ra = accelerate (ease-in), ra ngắn hơn vào ~40%
   - Stagger tổng < 0.5s; ba lớp: chính (nội dung) · phụ (polaroid, con dấu) · nền (kính lúp trôi nhẹ)
   - Tôn trọng prefers-reduced-motion; không có GSAP thì mọi hàm là no-op
   ========================================================= */
(function () {
  "use strict";
  const g = window.gsap;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enabled = !!g && !reduce;
  const done = () => Promise.resolve();

  if (!enabled) {
    window.Motion = { enabled: false, init() {}, stepOut: done, stepIn() {}, modalIn() {}, modalOut: done, pulse() {}, shake() {}, successIn() {}, cardsIn() {} };
    return;
  }

  document.documentElement.classList.add("js-motion");
  if (window.ScrollTrigger) g.registerPlugin(ScrollTrigger);
  let EASE = "power2.out";
  if (window.CustomEase) { g.registerPlugin(CustomEase); CustomEase.create("mg", "0.4,0,0.2,1"); EASE = "mg"; }
  const D = { quick: 0.2, std: 0.45, slow: 0.8 };
  g.defaults({ ease: EASE, duration: D.std });
  let ready = false;

  function heroIn() {
    const tl = g.timeline({ defaults: { ease: EASE } });
    // Lớp chính: copy vào theo thứ tự đọc
    tl.fromTo(".hero-copy .hero-anim", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: D.slow, stagger: { amount: 0.4 } }, 0.1);
    // Lớp phụ: tập hồ sơ → polaroid → con dấu "đóng" xuống
    tl.fromTo(".folder", { y: 40, rotation: -2, autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, duration: D.slow }, 0.2)
      .fromTo(".polaroid", { y: -24, rotation: 0, autoAlpha: 0 }, { y: 0, rotation: 4, autoAlpha: 1, duration: D.slow }, "<0.2")
      .fromTo(".stamp", { scale: 1.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 0.9, duration: 0.3, ease: "power3.in" }, ">-0.1")
      .fromTo(".folder", { y: 0 }, { y: 3, duration: 0.08, yoyo: true, repeat: 1, ease: "power1.inOut" }, ">"); // dư chấn khi đóng dấu
    // Lớp nền: kính lúp trôi chậm (sine, lặp)
    g.to(".hero-mag", { y: -10, rotation: -4, duration: 3.2, ease: "sine.inOut", yoyo: true, repeat: -1 });
  }

  function reveals() {
    const items = g.utils.toArray(".reveal");
    if (!window.ScrollTrigger) { g.set(items, { autoAlpha: 1 }); return; }
    g.set(items, { y: 24, autoAlpha: 0 });
    ScrollTrigger.batch(items, {
      start: "top 88%", once: true,
      onEnter: els => g.to(els, { y: 0, autoAlpha: 1, duration: D.slow, stagger: { each: 0.08, amount: 0.4 }, overwrite: true }),
    });
  }

  window.Motion = {
    enabled: true,
    init() {
      heroIn(); reveals(); ready = true;
      // Ảnh/khối thay đổi kích thước sau khi font tải xong
      if (document.fonts && document.fonts.ready && window.ScrollTrigger) document.fonts.ready.then(() => ScrollTrigger.refresh());
    },
    cardsIn(els) {
      if (!ready || !els.length) return;
      g.fromTo(els, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: D.std, stagger: { amount: 0.3 }, overwrite: true });
    },
    // Chuyển bước: ra nhanh (ease-in), vào chậm hơn (ease-out), hướng ngang = tiến trình
    stepOut(el) { return new Promise(r => g.to(el, { autoAlpha: 0, x: -16, duration: D.quick, ease: "power2.in", onComplete: r })); },
    stepIn(el) { g.fromTo(el, { autoAlpha: 0, x: 16 }, { autoAlpha: 1, x: 0, duration: D.std, clearProps: "transform" }); },
    // Modal: vật nặng → không nảy, 0.4s vào / 0.22s ra
    modalIn(dialog, backdrop) {
      g.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 });
      g.fromTo(dialog, { y: 24, scale: 0.98, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4 });
      g.fromTo(dialog.querySelectorAll(".profile-block, .profile-actions"), { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: D.std, stagger: { amount: 0.25 }, delay: 0.12 });
    },
    modalOut(dialog, backdrop) {
      g.to(backdrop, { autoAlpha: 0, duration: 0.22, ease: "power2.in" });
      return new Promise(r => g.to(dialog, { y: 12, autoAlpha: 0, duration: 0.22, ease: "power2.in", onComplete: () => { g.set([dialog, backdrop], { clearProps: "all" }); r(); } }));
    },
    // Lightbox: ảnh hiện lên nhẹ (scale nhỏ, không nảy)
    lbIn(img) { g.fromTo(img, { autoAlpha: 0, scale: 0.97 }, { autoAlpha: 1, scale: 1, duration: 0.35 }); },
    // Phản hồi khi tổng tiền đổi
    pulse(el) { if (el) g.fromTo(el, { scale: 1.08, color: "#B8302A" }, { scale: 1, color: "#15223B", duration: D.std, transformOrigin: "right center", clearProps: "color" }); },
    // Lỗi: lắc 2–3 lần, 0.35s, không overshoot
    shake(el) { g.fromTo(el, { x: 0 }, { keyframes: { x: [-8, 8, -5, 5, 0] }, duration: 0.35, ease: "power1.inOut" }); },
    // Thành công: icon nở + vẽ dấu tick, rồi nội dung
    successIn(el) {
      g.set(el, { autoAlpha: 1, x: 0 });
      const tl = g.timeline();
      tl.fromTo(el.querySelector(".success-icon"), { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: D.std })
        .fromTo(el.querySelector(".success-icon path"), { strokeDashoffset: 48 }, { strokeDashoffset: 0, duration: 0.5 }, "<0.15")
        .fromTo(el.querySelectorAll(".success > :not(.success-icon)"), { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: D.std, stagger: { amount: 0.35 } }, "<0.1");
    },
  };
})();
