# 1Password の参照。値は書かない。使い方: op run --env-file .dev.vars.tpl -- <コマンド>  /  Workers の手元実行: op inject -i .dev.vars.tpl -o .dev.vars
ADMIN_TOKEN=op://hb-dev-secrets/dev-croquis-tool-env/ADMIN_TOKEN
OPENAI_API_KEY=op://hb-dev-secrets/dev-croquis-tool-env/OPENAI_API_KEY
AUTH_SECRET=op://hb-dev-secrets/dev-croquis-tool-env/AUTH_SECRET
