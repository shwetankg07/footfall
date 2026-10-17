import { useSelector } from "react-redux";
import { Link, useMatch } from "react-router-dom";
import { usePopover } from "./usePopover";
import Icon from "./Icon";

export const SiteMark = ({ name }) => <span className="site-mark" aria-hidden="true">{name?.[0] ?? "?"}</span>;

export default function SiteSwitcher() {
  const sites = useSelector((state) => state.sites.list);
  const match = useMatch("/sites/:siteId/*");
  const current = sites.find((site) => site._id === match?.params.siteId);
  const { open, setOpen, ref } = usePopover();

  return (
    <div className="switcher" ref={ref}>
      <button type="button" className="switcher-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SiteMark name={current?.name ?? "All"} />
        <span className="names">
          <span>{current?.name ?? "All sites"}</span>
          <span>{current?.domain ?? `${sites.length} ${sites.length === 1 ? "site" : "sites"}`}</span>
        </span>
        <Icon name="chevrons" size={14} />
      </button>
      {open && (
        <div className="popover" role="menu">
          {sites.map((site) => (
            <Link key={site._id} to={`/sites/${site._id}`} className="menu-item" aria-current={site._id === current?._id} onClick={() => setOpen(false)}>
              <SiteMark name={site.name} />
              {site.name}
              <span className="muted">{site.domain}</span>
            </Link>
          ))}
          {sites.length > 0 && <div className="menu-sep" />}
          <Link to="/sites" className="menu-item" onClick={() => setOpen(false)}><Icon name="sites" />All sites</Link>
          <Link to="/sites?add=1" className="menu-item" onClick={() => setOpen(false)}><Icon name="plus" />Add a site</Link>
        </div>
      )}
    </div>
  );
}
