#!/usr/bin/env bash
# Smoke test: drive a fresh Stalwart v0.16 through the backend setup flow.
set -euo pipefail
SECRET='stalmail-admin:smoke-secret-123'
PORT=18080
NAME=stalmail-smoke

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm ${NAME}-etc ${NAME}-data >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker volume create ${NAME}-etc >/dev/null; docker volume create ${NAME}-data >/dev/null
docker run -d --name "$NAME" -e STALWART_RECOVERY_ADMIN="$SECRET" -p ${PORT}:8080 \
  -v ${NAME}-etc:/etc/stalwart -v ${NAME}-data:/var/lib/stalwart stalwartlabs/stalwart:v0.16 >/dev/null

AUTH=$(printf '%s' "$SECRET" | base64)
J() { curl -s -m 12 -X POST -H "Authorization: Basic $AUTH" -H 'Content-Type: application/json' -d "$1" http://localhost:${PORT}/jmap/; }

until curl -sf http://localhost:${PORT}/healthz/live >/dev/null 2>&1; do sleep 1; done
echo "1. bootstrap mode reached:"; docker logs "$NAME" 2>&1 | grep -q 'bootstrap mode' && echo "   OK" || { echo "   FAIL (no 'bootstrap mode' in logs)"; exit 1; }

echo "2. submit bootstrap:"
J '{"using":["urn:stalwart:jmap"],"methodCalls":[["x:Bootstrap/set",{"accountId":"d333333","update":{"singleton":{"serverHostname":"mail.smoke.test","defaultDomain":"smoke.test","requestTlsCertificate":false,"generateDkimKeys":true,"directory":{"@type":"Internal"},"dnsServer":{"@type":"Manual"}}}},"0"]]}' | grep -q '"username":"admin@smoke.test"' && echo "   OK (admin generated)" || { echo "   FAIL (no admin@smoke.test in bootstrap response)"; exit 1; }

echo "3. restart -> normal mode:"; docker restart "$NAME" >/dev/null; sleep 8
until curl -sf http://localhost:${PORT}/healthz/live >/dev/null 2>&1; do sleep 1; done
DOMAIN=$(J '{"using":["urn:stalwart:jmap"],"methodCalls":[["x:Domain/query",{"accountId":"d333333"},"0"],["x:Domain/get",{"accountId":"d333333","#ids":{"resultOf":"0","name":"x:Domain/query","path":"/ids"}},"1"]]}')
echo "$DOMAIN" | grep -q '"name":"smoke.test"' && echo "   OK (domain present in normal mode)" || { echo "   FAIL (smoke.test domain not found)"; exit 1; }
echo "$DOMAIN" | grep -q 'dnsZoneFile' && echo "   OK (dnsZoneFile exposed)" || { echo "   FAIL (dnsZoneFile not found)"; exit 1; }

# Extract the real domain id from the x:Domain/query ids array (e.g. "ids":["b"])
DOMAIN_ID=$(printf '%s' "$DOMAIN" | grep -o '"ids":\["[^"]*"' | sed 's/"ids":\["\([^"]*\)"/\1/' | head -1)
if [ -z "$DOMAIN_ID" ]; then
  echo "   FAIL (could not extract domain id)"; exit 1
fi
echo "   domain id extracted: $DOMAIN_ID"

echo "4. create admin account:"
J "{\"using\":[\"urn:stalwart:jmap\"],\"methodCalls\":[[\"x:Account/set\",{\"accountId\":\"d333333\",\"create\":{\"u1\":{\"@type\":\"User\",\"name\":\"koffi\",\"domainId\":\"${DOMAIN_ID}\",\"credentials\":{\"0\":{\"@type\":\"Password\",\"secret\":\"correct horse battery staple x9\"}},\"roles\":{\"@type\":\"Admin\"}}}},\"0\"]]}" | grep -q '"created"' && echo "   OK (admin user created)" || { echo "   FAIL (account not created)"; exit 1; }

echo "SMOKE PASSED"
