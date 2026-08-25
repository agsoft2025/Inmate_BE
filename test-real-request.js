const http = require('http');

function testRealGet(path, origin) {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: path,
    method: 'GET',
    headers: {
      'Origin': origin
    }
  };

  const req = http.request(options, (res) => {
    console.log(`\n=== GET ${path} (Origin: ${origin}) ===`);
    console.log(`Status: ${res.statusCode}`);
    console.log(`Access-Control-Allow-Origin: ${res.headers['access-control-allow-origin'] || '(not set)'}`);
    console.log(`Access-Control-Allow-Credentials: ${res.headers['access-control-allow-credentials'] || '(not set)'}`);
    
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`Response: ${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`);
    });
  });

  req.on('error', (err) => {
    console.error(`Error for ${path}:`, err.message);
  });

  req.end();
}

// Test actual GET requests (no auth token, should get 401 but with CORS headers)
console.log('Testing actual GET requests without auth:');
testRealGet('/location', 'http://[::1]:5173');
testRealGet('/dashboard', 'http://[::1]:5173');
testRealGet('/inmate', 'http://[::1]:5173');
