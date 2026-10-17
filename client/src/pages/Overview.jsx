import { useOutletContext } from "react-router-dom";
import TrafficView from "../components/TrafficView";
import InstallSnippet from "../components/InstallSnippet";

export default function Overview() {
  const { site } = useOutletContext();
  const base = `/api/sites/${site._id}`;

  return (
    <TrafficView
      apiBase={base}
      forecastPath={site.plan === "free" ? undefined : `${base}/forecast`}
      timezone={site.timezone}
      limitedHistory={site.plan === "free"}
      before={!site.installed && <InstallSnippet site={site} />}
    />
  );
}
