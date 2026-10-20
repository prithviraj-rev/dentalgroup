// Preloaded into the server for testing: answers Intuit's OAuth and API calls with fake data.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof URL ? input.href : input?.url || input);
  const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('oauth.platform.intuit.com')) {
    return json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, x_refresh_token_expires_in: 8640000 });
  }
  if (url.includes('quickbooks.api.intuit.com')) {
    const realm = url.match(/company\/(\d+)/)?.[1];
    if (url.includes('/companyinfo/')) return json({ CompanyInfo: { CompanyName: `Test Company ${realm}`, LegalName: `Test Company ${realm}` } });
    if (url.includes('/query')) return json({ QueryResponse: { Account: [] } });
    if (url.includes('ProfitAndLoss')) return json({ Columns: { Column: [{ ColType: 'Account' }, { ColType: 'Money', MetaData: [{ Name: 'StartDate', Value: '2026-09-01' }, { Name: 'EndDate', Value: '2026-09-30' }] }, { ColTitle: 'Total' }] }, Rows: { Row: [{ type: 'Section', group: 'Income', Header: { ColData: [{ value: 'Income' }] }, Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Sales', id: '1' }, { value: '100' }, { value: '100' }] }] } }] } });
  }
  return realFetch(input, init);
};
