import { useDispatch } from "react-redux";
import { API_URL } from "../services/api";
import { addToast } from "../store/toastSlice";

export const snippetFor = (domain) => `<script defer src="${API_URL}/t.js" data-site="${domain}"></script>`;

export default function InstallSnippet({ site, waiting = true }) {
  const dispatch = useDispatch();
  const snippet = snippetFor(site.domain);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      dispatch(addToast("Snippet copied"));
    } catch {
      dispatch(addToast("Couldn't copy. Select the text and copy it yourself.", "error"));
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Add Footfall to {site.domain}</h2>
        {waiting && <span className="live"><span className="live-dot" aria-hidden="true" />Waiting for the first visit</span>}
      </div>
      <p className="ink-2">Paste this line inside the <code>&lt;head&gt;</code> of every page. It's under 2 KB, sets no cookies, and this page updates by itself as soon as the first visit arrives.</p>
      <pre className="snippet">{snippet}</pre>
      <div className="row">
        <button type="button" className="btn primary" onClick={copy}>Copy snippet</button>
        <span className="muted small">Track a custom event with <code>window.footfall("signup")</code>.</span>
      </div>
    </section>
  );
}
