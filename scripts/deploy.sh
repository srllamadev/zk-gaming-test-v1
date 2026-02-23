#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  deploy.sh — Compila y despliega ZK Roulette en Stellar Testnet
#
#  Requisitos:
#    - Stellar CLI instalado: https://developers.stellar.org/docs/tools/developer-tools/cli/install-stellar-cli
#    - Cuenta en Testnet con fondos (usa `stellar keys fund`)
#    - Rust con target wasm32-unknown-unknown
#
#  USO:
#    chmod +x scripts/deploy.sh
#    ./scripts/deploy.sh [NOMBRE_CUENTA]          # por defecto: "deployer"
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

ACCOUNT="${1:-deployer}"
NETWORK="testnet"
GAME_HUB="CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   ZK Roulette — Deploy a Stellar Testnet         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Cuenta  : $ACCOUNT"
echo "  Red     : $NETWORK"
echo "  Game Hub: $GAME_HUB"
echo ""

# ── 1. Verificar Stellar CLI ────────────────────────────────────────────────
if ! command -v stellar &> /dev/null; then
    echo "ERROR: Stellar CLI no encontrado."
    echo "  Instalar: https://developers.stellar.org/docs/tools/developer-tools/cli/install-stellar-cli"
    exit 1
fi
echo "[1/6] Stellar CLI: $(stellar --version)"

# ── 2. Generar / verificar cuenta de deploy ─────────────────────────────────
echo ""
echo "[2/6] Verificando cuenta '$ACCOUNT' en Testnet..."
if ! stellar keys show "$ACCOUNT" &> /dev/null; then
    echo "  Cuenta no encontrada. Generando nueva..."
    stellar keys generate "$ACCOUNT" --network "$NETWORK"
    echo "  Fondeando con Friendbot..."
    stellar keys fund "$ACCOUNT" --network "$NETWORK"
else
    echo "  Cuenta encontrada: $(stellar keys address "$ACCOUNT")"
fi

DEPLOYER_ADDR=$(stellar keys address "$ACCOUNT")
echo "  Dirección: $DEPLOYER_ADDR"

# ── 3. Compilar contrato ─────────────────────────────────────────────────────
echo ""
echo "[3/6] Compilando contrato Soroban..."
stellar contract build --manifest-path contract/Cargo.toml
WASM_PATH="contract/target/wasm32-unknown-unknown/release/zk_roulette.wasm"

if [ ! -f "$WASM_PATH" ]; then
    # Buscar el archivo con guion bajo o guion
    WASM_PATH=$(find contract/target -name "*.wasm" | head -1)
    if [ -z "$WASM_PATH" ]; then
        echo "ERROR: No se encontró el WASM compilado"
        exit 1
    fi
fi
echo "  WASM: $WASM_PATH ($(du -sh "$WASM_PATH" | cut -f1))"

# ── 4. Subir WASM a la red ───────────────────────────────────────────────────
echo ""
echo "[4/6] Subiendo WASM a Testnet..."
WASM_HASH=$(stellar contract install \
    --wasm "$WASM_PATH" \
    --source "$ACCOUNT" \
    --network "$NETWORK")
echo "  WASM Hash: $WASM_HASH"

# ── 5. Desplegar contrato ────────────────────────────────────────────────────
echo ""
echo "[5/6] Desplegando contrato..."
CONTRACT_ID=$(stellar contract deploy \
    --wasm-hash "$WASM_HASH" \
    --source "$ACCOUNT" \
    --network "$NETWORK")
echo "  Contract ID: $CONTRACT_ID"

# ── 6. Inicializar contrato ──────────────────────────────────────────────────
echo ""
echo "[6/6] Inicializando contrato con Game Hub..."
stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$ACCOUNT" \
    --network "$NETWORK" \
    -- \
    initialize \
    --game_hub "$GAME_HUB"
echo "  Contrato inicializado correctamente."

# ── Guardar variables de entorno ─────────────────────────────────────────────
ENV_FILE=".env"
cat > "$ENV_FILE" << EOF
# Generado por scripts/deploy.sh — $(date -u +"%Y-%m-%d %H:%M:%S UTC")
VITE_CONTRACT_ID=$CONTRACT_ID
VITE_GAME_HUB=$GAME_HUB
VITE_DEPLOYER_ADDRESS=$DEPLOYER_ADDR
VITE_NETWORK=$NETWORK
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
VITE_SOROBAN_RPC=https://soroban-testnet.stellar.org
EOF
echo ""
echo "  Variables guardadas en: $ENV_FILE"

# ── Resumen ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   ✓ Deploy completado exitosamente               ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Contract ID:                                    ║"
echo "║  $CONTRACT_ID  ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Explorador:                                     ║"
echo "║  https://stellar.expert/explorer/testnet/        ║"
echo "║  contract/$CONTRACT_ID  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Copia el Contract ID al frontend:"
echo "  frontend/index.html → const CONTRACT_ID = \"$CONTRACT_ID\";"
echo ""
