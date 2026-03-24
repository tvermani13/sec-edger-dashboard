export default async function handler(req, res) {
  try {
    const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: {
        'User-Agent': 'SEC-Dashboard contact@example.com',
        'Accept-Encoding': 'gzip, deflate',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'SEC API error' });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
