import { API_URL } from "../services/api";

const src = `${API_URL}/t.js`;

// The plain tracking line. Every stack below ends up putting this tag in the page's <head>.
export const snippetFor = (domain) => `<script defer src="${src}" data-site="${domain}"></script>`;

const head = (file) => ({ file, where: "inside <head>", code: snippetFor });

// Where the line goes in each stack, and the exact code to paste there.
export const GUIDES = [
  {
    group: "Any website",
    items: [{ id: "html", name: "HTML", file: "every page, or your shared header", where: "inside <head>", code: snippetFor }],
  },
  {
    group: "JavaScript frameworks",
    items: [
      { id: "vite", name: "React or Vue (Vite)", ...head("index.html") },
      { id: "cra", name: "Create React App", ...head("public/index.html") },
      {
        id: "next-app",
        name: "Next.js (App Router)",
        file: "app/layout.js",
        where: "inside <body>, with the import at the top",
        code: (domain) => `import Script from "next/script";\n\n<Script src="${src}" data-site="${domain}" strategy="afterInteractive" />`,
      },
      { id: "next-pages", name: "Next.js (Pages Router)", file: "pages/_document.js", where: "inside <Head>", code: snippetFor },
      { id: "remix", name: "Remix or React Router", ...head("app/root.tsx") },
      {
        id: "nuxt",
        name: "Nuxt",
        file: "nuxt.config.ts",
        where: "inside defineNuxtConfig({ … })",
        code: (domain) => `app: {\n  head: {\n    script: [{ src: "${src}", defer: true, "data-site": "${domain}" }],\n  },\n},`,
      },
      { id: "sveltekit", name: "SvelteKit", ...head("src/app.html") },
      { id: "angular", name: "Angular", ...head("src/index.html") },
      {
        id: "astro",
        name: "Astro",
        file: "your layout, e.g. src/layouts/Layout.astro",
        where: "inside <head>",
        code: (domain) => `<script is:inline defer src="${src}" data-site="${domain}"></script>`,
      },
      {
        id: "gatsby",
        name: "Gatsby",
        file: "gatsby-ssr.js",
        where: "as a new export",
        code: (domain) => `export const onRenderBody = ({ setHeadComponents }) =>\n  setHeadComponents([<script key="footfall" defer src="${src}" data-site="${domain}" />]);`,
      },
    ],
  },
  {
    group: "Site builders and CMS",
    items: [
      { id: "wordpress", name: "WordPress", steps: "Appearance → Theme File Editor → header.php, just before </head>. Or paste it into any “insert headers” plugin.", code: snippetFor },
      { id: "shopify", name: "Shopify", steps: "Online Store → Themes → Edit code → layout/theme.liquid, just before </head>.", code: snippetFor },
      { id: "webflow", name: "Webflow", steps: "Site settings → Custom code → Head code, then publish.", code: snippetFor },
      { id: "squarespace", name: "Squarespace", steps: "Code Injection → Header (under Settings or Website Tools, depending on your version).", code: snippetFor },
      { id: "wix", name: "Wix", steps: "Settings → Custom code → Add code. Place it in Head, on all pages.", code: snippetFor },
      { id: "framer", name: "Framer", steps: "Site settings → General → Custom code → the <head> box, then publish.", code: snippetFor },
    ],
  },
  {
    group: "Server frameworks",
    items: [
      { id: "django", name: "Django", ...head("templates/base.html") },
      { id: "flask", name: "Flask", ...head("templates/base.html") },
      { id: "laravel", name: "Laravel", ...head("resources/views/layouts/app.blade.php") },
      { id: "rails", name: "Ruby on Rails", ...head("app/views/layouts/application.html.erb") },
      { id: "express", name: "Express", ...head("your layout or head partial, e.g. views/partials/head.ejs") },
      { id: "php", name: "PHP", ...head("your shared header.php") },
    ],
  },
];

export const guideById = (id) => GUIDES.flatMap((group) => group.items).find((guide) => guide.id === id) ?? GUIDES[0].items[0];
