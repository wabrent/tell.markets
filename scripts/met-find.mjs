// Finds public-domain images in The Met collection for site art.  node scripts/met-find.mjs "query" ...
const H = { 'user-agent': 'Mozilla/5.0 tell-design' };
for (const q of process.argv.slice(2)) {
  const s = await (await fetch(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=${encodeURIComponent(q)}&hasImages=true&isPublicDomain=true&limit=12`, { headers: H })).json();
  console.log(`\n## ${q} (${s.total})`);
  for (const id of s.objectIDs ?? []) {
    const o = await (await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { headers: H })).json();
    if (!o.isPublicDomain || !o.primaryImage) continue;
    console.log(`${id} | ${o.title?.slice(0, 60)} | ${o.objectDate} | ${o.department} | ${o.primaryImage}`);
  }
}
