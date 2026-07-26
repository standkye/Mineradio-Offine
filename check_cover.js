const http = require('http');
http.get('http://localhost:3000/api/local/search?keywords=' + encodeURIComponent('무제'), (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const j = JSON.parse(data);
    const s = j.songs[0];
    console.log('coverPath:', JSON.stringify(s.coverPath));
    console.log('hasCover:', s.hasCover);
    console.log('localPath:', JSON.stringify(s.localPath));
  });
});
