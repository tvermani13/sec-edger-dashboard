export default async function handler(req, res) {
  const { cik } = req.query;

  if (!cik || !/^\d{10}$/.test(cik)) {
    return res.status(400).json({ error: 'Invalid CIK' });
  }

  try {
    const response = await fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      {
        headers: {
          'User-Agent': 'SEC-Dashboard contact@example.com',
          'Accept-Encoding': 'gzip, deflate',
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'SEC API error' });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
