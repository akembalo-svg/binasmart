// pm2 process definition for the GraphHopper routing server (mirrors the live `gh-routing` app).
// Usage on the VPS: pm2 start ops/routing/ecosystem.config.js && pm2 save
module.exports = { apps: [{
  name: 'gh-routing',
  script: 'java',
  args: '-Xmx2g -XX:+ExitOnOutOfMemoryError -jar /root/routing/graphhopper-web-10.0.jar server /root/routing/config.yml',
  cwd: '/root/routing',
  min_uptime: 60000, max_restarts: 10, restart_delay: 5000, max_memory_restart: '1500M',
  autorestart: true
}] };
