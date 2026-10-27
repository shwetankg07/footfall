import { useState } from "react";
import { useDispatch } from "react-redux";
import { addToast } from "../store/toastSlice";
import { GUIDES, guideById } from "../utils/installGuides";

export default function InstallSnippet({ site, waiting = true }) {
  const dispatch = useDispatch();
  const [stack, setStack] = useState("html");
  const guide = guideById(stack);
  const code = guide.code(site.domain);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      dispatch(addToast(`Copied the ${guide.name} snippet`));
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
      <p className="ink-2">One line on your site, under 2 KB and no cookies. This page updates by itself as soon as the first visit arrives.</p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="install-stack">Your stack</label>
        <select id="install-stack" value={stack} onChange={(event) => setStack(event.target.value)}>
          {GUIDES.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="ink-2">
        {guide.steps ?? <>Open <code>{guide.file}</code> and paste this {guide.where}.</>}
      </p>
      <pre className="snippet">{code}</pre>
      <div className="row">
        <button type="button" className="btn primary" onClick={copy}>Copy snippet</button>
        <span className="muted small">Track a custom event with <code>window.footfall("signup")</code>.</span>
      </div>
      <p className="muted small">
        Single-page apps need nothing extra: route changes are tracked on their own. Testing on localhost? Add <code>data-dev</code> to the tag, since
        local pages are ignored otherwise.
      </p>
    </section>
  );
}
