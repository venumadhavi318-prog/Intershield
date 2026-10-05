/* ==========================================================================
   InternShield — scroll-driven animation layer (GSAP + ScrollTrigger)
   Loaded after vendor/gsap.min.js and vendor/ScrollTrigger.min.js.
   Self-contained so a failure here never affects the checker/auth/admin code.
   ========================================================================== */
(function () {
  function init() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Static fallback: show final metric values if GSAP is missing or motion is reduced.
    if (!window.gsap || !window.ScrollTrigger || reduceMotion) {
      document.querySelectorAll(".statNumber").forEach(el => { el.textContent = el.dataset.target; });
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const heroScrollEnd = () => "+=" + Math.max(window.innerHeight * 1.3, 620);
    const isNarrow = () => window.innerWidth < 980;
    const q = gsap.utils.selector("#heroVisual");

    /* ---------- Page-load timeline ---------- */
    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from(".heroReveal", { opacity: 0, y: 34, duration: .8, stagger: .12, clearProps: "transform" })
      .from(".shieldCore", { opacity: 0, scale: .74, duration: 1.05 }, 0.1)
      .from(".shieldRings", { opacity: 0, scale: .85, duration: 1, ease: "power2.out" }, 0.2)
      .from(".floatChip", { opacity: 0, y: 18, scale: .9, duration: .55, stagger: .12 }, 0.5)
      .from(".scrollHint", { opacity: 0, y: 10, duration: .5 }, 0.9);

    /* ---------- Statistics: individual reveal + count-up on page load ---------- */
    gsap.from(".impactStat", {
      opacity: 0, y: 26, duration: .6, stagger: .18, delay: 1.0, ease: "power2.out", clearProps: "transform"
    });
    gsap.utils.toArray(".statNumber").forEach((el, i) => {
      const target = Number(el.dataset.target || 0);
      const counter = { value: 0 };
      el.textContent = "0";
      gsap.to(counter, {
        value: target, duration: 1.1, delay: 1.1 + i * .18, ease: "power2.out",
        onUpdate: () => { el.textContent = Math.round(counter.value); }
      });
    });

    /* ---------- Scroll-driven hero: 5 stages, directly tied to scroll progress ---------- */
    const stage = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: "#home",
        start: "top top",
        end: heroScrollEnd,
        scrub: 1,
        pin: "#heroPin",
        pinSpacing: true,
        anticipatePin: 1,
        invalidateOnRefresh: true
      }
    });
    const dx = () => (isNarrow() ? window.innerWidth * 0.16 : Math.min(window.innerWidth * 0.24, 320));

    stage
      // Stage 1 → 2: move right, scale up
      .to("#heroVisual", { x: dx, scale: () => (isNarrow() ? 1.04 : 1.12), rotation: 0 })
      // Stage 3: rotate gently, return toward center
      .to("#heroVisual", { x: 0, scale: () => (isNarrow() ? 1.0 : 1.04), rotation: 8 })
      // Stage 4: move left, shrink toward the next section
      .to("#heroVisual", { x: () => -dx(), scale: () => (isNarrow() ? .92 : .96), rotation: -6 })
      // Stage 5: settle into the final centered position
      .to("#heroVisual", { x: 0, scale: 1, rotation: 0 });

    // Decorative parallax through the same scroll range.
    const chip = (sel, vars) => q(sel).forEach(el => gsap.to(el, { ...vars, ease: "none", scrollTrigger: { trigger: "#home", start: "top top", end: heroScrollEnd, scrub: 1 } }));
    chip(".chipOne", { y: -22, rotation: 4 });
    chip(".chipTwo", { y: 26, rotation: -5 });
    chip(".chipThree", { y: -30, rotation: 6 });
    chip(".visualGlow", { scale: 1.18, opacity: .8 });

    /* ---------- Scroll story ---------- */
    gsap.fromTo(".scrollCopy", { opacity: .25, y: 30 }, {
      opacity: 1, y: 0, ease: "none",
      scrollTrigger: { trigger: "#scrollStory", start: "top 75%", end: "top 30%", scrub: 1 }
    });
    const storyTrigger = { trigger: "#scrollStory", start: "top top", end: "bottom bottom" };
    gsap.to("#scrollOrb", { x: () => (isNarrow() ? 60 : 200), y: -90, rotation: 300, scale: .72, ease: "none", scrollTrigger: { ...storyTrigger, scrub: 1.25 } });
    gsap.to(".orbitA", { rotation: 180, scale: 1.12, ease: "none", scrollTrigger: { ...storyTrigger, scrub: 1.5 } });
    gsap.to(".orbitB", { rotation: -120, scale: .9, ease: "none", scrollTrigger: { ...storyTrigger, scrub: 1.8 } });
    gsap.to(".signalA", { x: -70, y: 80, opacity: .3, ease: "none", scrollTrigger: { ...storyTrigger, scrub: 1 } });
    gsap.to(".signalB", { x: -140, y: -100, opacity: .3, ease: "none", scrollTrigger: { ...storyTrigger, scrub: 1 } });
    gsap.to(".signalC", { x: 140, y: -50, opacity: .3, ease: "none", scrollTrigger: { ...storyTrigger, scrub: 1 } });

    /* Three story stages reveal progressively as the user scrolls */
    gsap.utils.toArray(".scrollStep").forEach((step, i) => {
      ScrollTrigger.create({
        trigger: step,
        start: () => `top ${78 - i * 8}%`,
        end: "bottom 30%",
        onEnter: () => step.classList.add("active"),
        onLeaveBack: () => step.classList.remove("active")
      });
    });

    /* ---------- Progressive card reveal ---------- */
    gsap.utils.toArray(".revealCard").forEach(card => {
      gsap.from(card, {
        opacity: 0, y: 30, duration: .7, ease: "power2.out",
        scrollTrigger: { trigger: card, start: "top 88%" }
      });
    });

    /* Keep trigger positions correct once fonts/layout settle. */
    window.addEventListener("load", () => ScrollTrigger.refresh());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
