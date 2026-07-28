#!/usr/bin/env bash
set -euo pipefail

identity_name="vimdown-dev"
login_keychain="$HOME/Library/Keychains/login.keychain-db"

existing="$(
  security find-identity -v -p codesigning 2>/dev/null || true
  security find-identity "$login_keychain" 2>/dev/null || true
)"
if printf '%s\n' "$existing" | grep -q "\"$identity_name\""; then
  echo "✓ '$identity_name' already exists. Nothing to do."
  exit 0
fi

cert_dir="$(mktemp -d)"
trap 'rm -rf "$cert_dir"' EXIT

key_path="$cert_dir/key.pem"
cert_path="$cert_dir/cert.pem"
p12_path="$cert_dir/cert.p12"
config_path="$cert_dir/openssl.cnf"
p12_password="$(/usr/bin/openssl rand -hex 24)"

cat > "$config_path" <<EOF
[ req ]
distinguished_name = req_dn
prompt = no
x509_extensions = v3_ext

[ req_dn ]
CN = $identity_name

[ v3_ext ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

echo "→ creating persistent '$identity_name' signing identity"
/usr/bin/openssl genrsa -out "$key_path" 2048 2>/dev/null
/usr/bin/openssl req -x509 -new -key "$key_path" -out "$cert_path" \
  -days 3650 -config "$config_path" -extensions v3_ext 2>/dev/null
/usr/bin/openssl pkcs12 -export \
  -inkey "$key_path" -in "$cert_path" -out "$p12_path" \
  -name "$identity_name" \
  -passin "pass:" -passout "pass:$p12_password" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg SHA1

security import "$p12_path" -k "$login_keychain" -P "$p12_password" \
  -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "" "$login_keychain" >/dev/null 2>&1 || true

echo "✓ '$identity_name' created in the login keychain."
