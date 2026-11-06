import React, { useState } from 'react';
import { Link, useLocation, useOutletContext } from 'react-router-dom';
import { dashboardUrl } from '../api.js';
import { useApp, can } from '../App.jsx';
import { Card, Empty, PageHeader } from '../ui.jsx';

/**
 * Embeds the existing P&L dashboard unchanged. Only organizations flagged liveDashboard get it,
 * because the dashboard holds that organization's real QuickBooks data.
 */
export default function Reports() {
  const { cfg } = useApp();
  const { org } = useOutletContext();
  const [loaded, setLoaded] = useState(false);
  const [stamp] = useState(() => Date.now());
  const tab = new URLSearchParams(useLocation().search).get('tab'); // from the shell's banner tabs on the other pages
  const embed = cfg.reports.embed;
  const src = dashboardUrl(cfg);

  if (!embed.enabled || !org.liveDashboard) {
    return (
      <>
        <PageHeader title="Reports" subtitle={org.name} />
        <Card>
          <Empty title={embed.placeholderTitle} action={can(org, 'entities.manage') && <Link className="btn btn-primary" to={`/o/${org.id}/entities`}>Manage entities</Link>}>
            {embed.placeholderBody}
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      {/* No title line (VJ 2026-10-28): the dashboard, with its own tabs on top, takes the whole window (reports.embed.height); the negative margins cancel the page padding (2026-10-29: no wasted space). */}
      <Card className="relative -m-3 overflow-hidden sm:-m-4" style={{ padding: 0, border: 0, borderRadius: 0 }}>
        {!loaded && <div className="absolute inset-0 animate-pulse bg-[var(--wash)]" />}
        <iframe
          title={`${org.name} reports`}
          key={`${stamp}-${tab || ''}`}
          src={`${src}${src.includes('?') ? '&' : '?'}t=${stamp}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`}
          onLoad={() => setLoaded(true)}
          className="block w-full border-0"
          style={{ height: embed.height }}
        />
      </Card>
    </>
  );
}
