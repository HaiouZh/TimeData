#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R timedata:timedata /app/data 2>/dev/null || true
  if [ -n "${DIARY_VAULT_DIR:-}" ]; then
    case "$DIARY_VAULT_DIR" in
      /app/vault | /app/vault/*)
        case "$DIARY_VAULT_DIR/" in
          */../* | */./*)
            echo "[diary] warning: refusing path traversal in DIARY_VAULT_DIR=$DIARY_VAULT_DIR" >&2
            ;;
          *)
            if ! mkdir -p /app/vault 2>/dev/null; then
              echo "[diary] warning: unable to create diary vault mount root /app/vault" >&2
            else
              diary_vault_ancestor="$DIARY_VAULT_DIR"
              while [ ! -e "$diary_vault_ancestor" ] && [ "$diary_vault_ancestor" != "/app/vault" ]; do
                diary_vault_ancestor="${diary_vault_ancestor%/*}"
              done
              if diary_vault_dir="$(readlink -f "$diary_vault_ancestor" 2>/dev/null)"; then
                case "$diary_vault_dir" in
                  /app/vault | /app/vault/*)
                    if ! chown -R timedata:timedata /app/vault 2>/dev/null; then
                      echo "[diary] warning: unable to grant timedata write access to /app/vault" >&2
                    fi
                    ;;
                  *)
                    echo "[diary] warning: refusing to change ownership outside /app/vault: $diary_vault_dir" >&2
                    ;;
                esac
              else
                echo "[diary] warning: unable to resolve DIARY_VAULT_DIR=$DIARY_VAULT_DIR" >&2
              fi
            fi
            ;;
        esac
        ;;
      *)
        echo "[diary] warning: refusing to create or change ownership outside /app/vault: $DIARY_VAULT_DIR" >&2
        ;;
    esac
  fi
  exec su-exec timedata "$0" "$@"
fi

exec "$@"
