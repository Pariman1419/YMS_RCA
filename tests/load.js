// k6 run -e API_URL=https://yms.example/api -e ACCESS_TOKEN=... tests/load.js
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '3m', target: 1000 },
    { duration: '5m', target: 1000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: { http_req_duration: ['p(95)<3000'], http_req_failed: ['rate<0.01'] },
};
export default function () {
  const result = http.get(`${__ENV.API_URL}/analytics/summary`, {
    headers: { Authorization: `Bearer ${__ENV.ACCESS_TOKEN}` },
  });
  check(result, { 'successful response': (r) => r.status === 200 });
  sleep(1);
}
