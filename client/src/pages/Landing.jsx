import { useRef } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import Logo from "../components/Logo";
import Icon from "../components/Icon";
import { API_URL } from "../services/api";
import { startDoorway } from "../utils/doorway";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, DrawSVGPlugin);

const DEMO = import.meta.env.VITE_DEMO_SHARE_PATH;

const FREE = ["Live visitors", "Pages, sources, devices and countries", "Funnels", "Team invites and share links", "3 sites, last 30 days"];
const PRO = ["Forecasts and spike or drop alerts", "Why it changed, on every alert", "Conversion drivers on every funnel", "A weekly list of fixes", "Unlimited sites and history"];

// A week of hourly page views with a daily rhythm, the model's normal range, and one campaign spike.
const W = 560;
const H = 150;
const SPIKE = 70;
const week = Array.from({ length: 168 }, (_, i) => {
  const hour = i % 24;
  const expected = 18 + 30 * Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2)) ** 1.5;
  const noise = Math.sin(i * 12.9898) * 43758.5453;
  const actual = i === SPIKE ? 194 : i === SPIKE + 1 ? 134 : expected * (0.8 + 0.4 * (noise - Math.floor(noise)));
  return { expected, actual };
});
const x = (i) => (i / 167) * W;
const y = (v) => H - (v / 200) * H;
const linePath = week.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.actual).toFixed(1)}`).join("");
const bandPath = [
  ...week.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.expected * 1.9 + 6).toFixed(1)}`),
  ...week.map((p, i) => [x(i), p]).reverse().map(([px, p]) => `L${px.toFixed(1)},${y(Math.max(0, p.expected * 0.35 - 3)).toFixed(1)}`),
  "Z",
].join("");

// From the seeded demo shop's checkout funnel.
const DRIVERS = [
  { label: "Visitors from linkedin.com", ratio: 2.4 },
  { label: "Mobile visitors", ratio: 0.4 },
  { label: "Visitors who land on /products", ratio: 0.4 },
];
// Odds ratios on a log scale, so 2x and 0.5x sit the same distance from "no difference".
const reach = (ratio) => `${Math.min(1, Math.abs(Math.log2(ratio)) / 1.5) * 50}%`;

// How far along the drawn line the spike's peak sits, so the alert lands as the line reaches it.
const spikeProgress = (path) => {
  const total = path.getTotalLength();
  for (let at = 0; at < total; at += 1) if (path.getPointAtLength(at).x >= x(SPIKE)) return at / total;
  return 0.5;
};

export default function Landing() {
  const user = useSelector((state) => state.auth.user);
  const start = user ? { to: "/sites", label: "Open dashboard" } : { to: "/register", label: "Start free" };
  const root = useRef(null);
  const hero = useRef(null);
  const scene = useRef(null);
  const door = useRef(null);
  const line = useRef(null);
  const count = useRef(null);

  useGSAP(
    () => {
      // index.html paints the landing black before React loads; hand the background back on the way out.
      const html = document.documentElement;
      const mm = gsap.matchMedia();
      mm.add({ motion: "(prefers-reduced-motion: no-preference)", wide: "(min-width: 760px)" }, ({ conditions }) => {
        const doorway = startDoorway(scene.current, door.current, {
          reduced: !conditions.motion,
          onEnter: (n) => (count.current.textContent = n.toLocaleString()),
        });
        if (!conditions.motion) return () => doorway.stop();

        // The light flickers on, then the headline sharpens out of the dark.
        const halves = root.current.querySelectorAll(".lp-title-half");
        const split = SplitText.create(halves, { type: "chars" });
        gsap
          .timeline()
          .to(doorway.state, { keyframes: { power: [0, 0.55, 0.08, 0.85, 0.4, 1] }, duration: 1.6, ease: "none" })
          .from(split.chars, { opacity: 0, y: "0.28em", filter: "blur(14px)", stagger: 0.045, duration: 1.3, ease: "expo.out" }, 0.5)
          .from(".lp-hero-foot > *, .lp-count", { opacity: 0, y: 14, stagger: 0.09, duration: 1, ease: "expo.out" }, 1)
          .from(".lp-bar > *", { opacity: 0, duration: 1, stagger: 0.06 }, 1.1);

        // Scrolling walks you up to the door: the headline parts, the light swells, and the rest
        // of the page rises over the room like a curtain (no pin spacing, so nothing scrolls past empty).
        // No scrub smoothing: the curtain moves with the real scroll, so the headline must too.
        if (conditions.wide) {
          gsap
            .timeline({ scrollTrigger: { trigger: hero.current, start: "top top", end: "+=100%", scrub: true, pin: true, pinSpacing: false } })
            .to(doorway.state, { enter: 1, ease: "power1.out", duration: 1 }, 0)
            // The curtain reaches the headline about halfway through, so it has to be gone by then.
            .to(".lp-title-l", { xPercent: -40, opacity: 0, ease: "power2.inOut", duration: 0.35 }, 0)
            .to(".lp-title-r", { xPercent: 40, opacity: 0, ease: "power2.inOut", duration: 0.35 }, 0)
            // Containers only: the intro animates their children, so the two timelines never fight over a value.
            .to(".lp-hero-foot, .lp-bar", { opacity: 0, y: -24, ease: "power1.in", duration: 0.3 }, 0)
            .to(".lp-door", { opacity: 0, ease: "power1.in", duration: 0.3 }, 0);
        }

        // The week draws as you scroll, and the alert lands the moment the line reaches the spike.
        const at = spikeProgress(line.current);
        gsap
          .timeline({ scrollTrigger: { trigger: ".lp-stage", start: "top 80%", end: "bottom 55%", scrub: 0.5 } })
          .fromTo(line.current, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1, ease: "none" }, 0)
          .fromTo(".lp-chart .dot", { scale: 0, svgOrigin: `${x(SPIKE)} ${y(194)}` }, { scale: 1, duration: 0.03 }, at)
          .fromTo(".lp-alert", { opacity: 0, y: 32, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.16, ease: "power2.out" }, at);

        // Driver bars grow out of the "no difference" line.
        const grow = { scaleX: 0, duration: 1.1, ease: "expo.out", stagger: 0.12, scrollTrigger: { trigger: ".lp-drivers", start: "top 78%", once: true } };
        gsap.from(".lp-ratio .up", { ...grow, transformOrigin: "left center" });
        gsap.from(".lp-ratio .down", { ...grow, transformOrigin: "right center" });

        document.fonts?.ready.then(() => ScrollTrigger.refresh());
        return () => doorway.stop();
      });
      return () => html.style.removeProperty("background");
    },
    { scope: root },
  );

  return (
    <div className="lp" ref={root}>
      <main>
        {/* Wrapper so the pin spacer GSAP adds never sits between React and its own nodes. */}
        <div>
          <section className="lp-hero" ref={hero}>
            <canvas className="lp-scene" ref={scene} aria-hidden="true" />
            <header className="lp-bar">
              <Link to="/" className="lp-wordmark"><Logo />Footfall</Link>
              <nav className="lp-nav" aria-label="Main">
                <Link to="/pricing">Pricing</Link>
                {DEMO && <Link to={DEMO}>Live demo</Link>}
                <a href="https://github.com/shwetankg07/footfall">Source</a>
              </nav>
              <div className="lp-bar-actions">
                {!user && <Link to="/login" className="lp-pill ghost small">Log in</Link>}
                <Link to={start.to} className="lp-pill small">{user ? "Dashboard" : "Start free"}</Link>
              </div>
            </header>

            <h1 className="lp-title">
              <span className="lp-title-half lp-title-l">Know who</span>
              <span className="lp-door" ref={door} aria-hidden="true">
                <span className="lp-count"><span className="lp-count-dot" /><b ref={count}>0</b> walked in</span>
              </span>
              <span className="lp-title-half lp-title-r">walked in.</span>
            </h1>

            <div className="lp-hero-foot">
              <p>Cookieless analytics for small websites, with alerts that say what changed and why.</p>
              <div className="lp-ctas">
                <Link to={start.to} className="lp-pill">{start.label}</Link>
                {DEMO && <Link to={DEMO} className="lp-pill ghost">See a live demo</Link>}
              </div>
            </div>
          </section>
        </div>

        <div className="lp-curtain">
          <div className="lp-body">
            <section className="lp-install" aria-label="Install">
              <code>{`<script defer src="${API_URL}/t.js" data-site="yoursite.com"></script>`}</code>
              <p>That's the whole install. Under 2 KB, and it never slows your page down.</p>
            </section>

            <section className="lp-section">
              <h2>Every alert says what changed.</h2>
              <div className="lp-split">
                <div className="lp-stage">
                  <figure className="lp-panel lp-chart">
                    <figcaption>Page views per hour, last 7 days</figcaption>
                    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="A week of hourly page views inside a shaded normal range, with one spike far above it">
                      <path d={bandPath} className="band" />
                      <path d={linePath} className="line" ref={line} />
                      <circle cx={x(SPIKE)} cy={y(194)} r="4" className="dot" />
                    </svg>
                  </figure>
                  <article className="lp-panel lp-alert">
                    <div className="lp-alert-head">
                      <span className="lp-alert-icon"><Icon name="trendUp" size={14} /></span>
                      <strong>Spike: 194 page views</strong>
                      <span className="lp-dim">Wed, 6:00 pm</span>
                    </div>
                    <p className="lp-dim">Normal for that hour is 7 to 95</p>
                    <ul>
                      <li><span className="lp-meter"><span style={{ width: "90%" }} /></span>90% came from linkedin.com<span className="lp-dim">152 vs about 15 usually</span></li>
                      <li><span className="lp-meter"><span style={{ width: "23%" }} /></span>23% came from the United States<span className="lp-dim">41 vs about 6 usually</span></li>
                      <li><span className="lp-meter"><span style={{ width: "20%" }} /></span>20% came from the United Kingdom<span className="lp-dim">36 vs about 5 usually</span></li>
                    </ul>
                  </article>
                </div>
                <div className="lp-aside">
                  <p className="lp-claim">
                    Footfall learns each site's weekly rhythm. <span className="lp-dim">When an hour breaks it, the alert names the source, page or device behind the jump, or says the whole site went quiet.</span>
                  </p>
                  <ul className="lp-features">
                    <li>A normal range for every hour</li>
                    <li>The cause on every alert</li>
                    <li>Outages told apart from slow days</li>
                    <li>Alerts live in the dashboard and by email</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="lp-section">
              <h2>See which visitors buy.</h2>
              <div className="lp-split reverse">
                <div className="lp-aside">
                  <p className="lp-claim">
                    Every funnel gets its conversion drivers. <span className="lp-dim">Each group of visitors is tested against everyone else, and a driver only shows when the evidence holds up.</span>
                  </p>
                  <ul className="lp-features">
                    <li>Odds ratios with a 95% range</li>
                    <li>Fisher tests, corrected for false finds</li>
                    <li>At least 30 visitors on each side</li>
                  </ul>
                </div>
                <figure className="lp-panel lp-drivers">
                  <figcaption>Checkout funnel, demo shop</figcaption>
                  <ul>
                    {DRIVERS.map((driver) => (
                      <li key={driver.label}>
                        <span>{driver.label}</span>
                        <span className="lp-ratio" aria-hidden="true">
                          <span className={driver.ratio > 1 ? "up" : "down"} style={{ width: reach(driver.ratio) }} />
                        </span>
                        <span className="lp-ratio-label">{driver.ratio}x as often</span>
                      </li>
                    ))}
                  </ul>
                </figure>
              </div>
            </section>

            <section className="lp-section lp-plans" aria-label="Plans">
              <div>
                <h3>Free</h3>
                <p className="lp-price">₹0</p>
                <ul>{FREE.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}</ul>
              </div>
              <div>
                <h3>Pro</h3>
                <p className="lp-price">₹499 <span className="lp-dim">a month</span></p>
                <ul>{PRO.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}</ul>
              </div>
              <p className="lp-dim lp-plans-note">Every account starts with 14 days of Pro. <Link to="/pricing">Compare plans</Link></p>
            </section>

            <section className="lp-final">
              <span className="lp-final-door" aria-hidden="true" />
              <h2>Add one line.<br />See who walks in.</h2>
              <div className="lp-ctas">
                <Link to={start.to} className="lp-pill">{start.label}</Link>
                {DEMO && <Link to={DEMO} className="lp-pill ghost">See a live demo</Link>}
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="lp-footer">
        <span>Footfall</span>
        <span><Link to="/pricing">Pricing</Link><a href="https://github.com/shwetankg07/footfall">Source</a></span>
      </footer>
    </div>
  );
}
