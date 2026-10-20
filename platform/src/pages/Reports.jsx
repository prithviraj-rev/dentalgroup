import React, { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
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
  const [stamp, setStamp] = useState(() => Date.now());
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
      <PageHeader
        title="Reports"
        subtitle="P&L dashboard, office comparison and chart of accounts"
        actions={<>
          <button type="button" className="btn" onClick={() => { setLoaded(false); setStamp(Date.now()); }}>Refresh</button>
          <a className="btn" href={src} target="_blank" rel="noreferrer">Open full screen ↗</a>
        </>}
      />
      <Card className="relative overflow-hidden">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-[var(--wash)]" />}
        <iframe
          title={`${org.name} reports`}
          key={stamp}
          src={`${src}${src.includes('?') ? '&' : '?'}t=${stamp}`}
          onLoad={() => setLoaded(true)}
          className="block w-full border-0"
          style={{ height: embed.height }}
        />
      </Card>
    </>
  );
}
