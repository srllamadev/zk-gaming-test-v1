# ZK Roulette for Streamers
### Stellar ZK Gaming Hackathon 2026 · Provable Randomness

> **Zero-Knowledge Commit-Reveal para sorteos en vivo 100% justos y verificables.**
> Ningún streamer puede manipular el resultado, y cualquiera puede auditarlo.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Circuito ZK | Noir `>= 0.36.0` + Poseidon BN254 |
| Smart Contract | Soroban / Rust (`soroban-sdk 22`) |
| Frontend | HTML + CSS + Vanilla JS (sin frameworks) |
| Wallet | Freighter (`@stellar/freighter-api`) |
| Red | Stellar Testnet · Protocol 25 (X-Ray) |

## Estructura

```
zk-project/
├── circuits/                  # Circuito Noir
│   ├── Nargo.toml
│   ├── Prover.toml            # Valores de ejemplo (dev only)
│   ├── README.md
│   └── src/
│       └── main.nr            # Lógica ZK commit-reveal
├── contract/                  # Contrato Soroban
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs             # commit_draw / register / reveal_winner
├── frontend/
│   └── index.html             # UI cósmica · toda la lógica JS
├── scripts/
│   └── deploy.sh              # Deploy automatizado a Testnet
├── Cargo.toml                 # Workspace Rust
└── README.md
```

## Setup Rápido

### 1. Circuito Noir

```bash
# Instalar Noir
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Compilar y testear
cd circuits
nargo compile
nargo test

# Generar proof de ejemplo (requiere actualizar Prover.toml)
nargo prove && nargo verify
```

### 2. Contrato Soroban

```bash
# Requisitos: Rust + target wasm32-unknown-unknown + Stellar CLI
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt

# Compilar
cargo build --target wasm32-unknown-unknown --release -p zk-roulette

# Tests
cargo test -p zk-roulette

# Deploy completo a Testnet (genera .env con CONTRACT_ID)
chmod +x scripts/deploy.sh
./scripts/deploy.sh mi-cuenta
```

### 3. Frontend

```bash
# Abrir en browser (no necesita build tools)
# 1. Copia CONTRACT_ID del .env generado por deploy.sh
# 2. Edita frontend/index.html → const CONFIG = { CONTRACT_ID: "..." }
# 3. Instala Freighter: https://freighter.app
open frontend/index.html
```

---

## Flujo ZK Commit-Reveal

```
STREAMER                          CONTRATO SOROBAN              PARTICIPANTES
    │                                    │                            │
    │── 1. Genera secreto + salt ────────┤                            │
    │   localmente (Web Crypto API)      │                            │
    │                                    │                            │
    │── 2. commit_draw(SHA-256(s|salt)) ─►  Guarda commitment         │
    │                                    │  on-chain                  │
    │                                    │                            │
    │                                    │◄── 3. register_participant ──│
    │                                    │    (espectadores)          │
    │                                    │                            │
    │── 4. close_registrations() ────────►  Congela lista             │
    │                                    │                            │
    │── 5. reveal_winner(secreto, salt) ─►  Verifica:                 │
    │   + Noir ZK Proof generado         │  SHA256(s|salt)==commitment │
    │                                    │  winner = s % n            │
    │                                    │  start_game() + end_game() │
    │                                    │  en Game Hub               │
    │                                    │                            │
    │◄───── Evento: winner_revealed ─────┤                            │
```

## Garantías de Seguridad

| Propiedad | Mecanismo | Garantía |
|-----------|-----------|----------|
| **Binding** | SHA-256 on-chain antes de registrar | El streamer no puede cambiar el secreto |
| **Hiding** | Salt de 32 bytes aleatorio | El secreto no puede deducirse del hash |
| **Fairness** | `winner = secreto % participantes` | Distribución uniforme |
| **Verifiability** | Noir circuit → UltraPlonk proof | Cualquiera puede verificar la prueba |
| **No-trust** | Commitment publicado antes del cierre | El organizador no conoce los participantes al comprometerse |

## Game Hub Integration

El contrato llama a `start_game()` y `end_game()` en:

```
CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
```

- `player1` = streamer (organizador)
- `player2` = ganador (determinado por ZK reveal)
- `end_game(player1_won: false)` → el ganador (player2) es el premiado

## Integración Real de Noir.js (Producción)

Para proof generation en el browser, reemplazar la función `simulateNoirProof`
en `frontend/index.html` con:

```js
import { Noir }                from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';
import circuit                 from '../circuits/target/zk_roulette.json';

const backend = new BarretenbergBackend(circuit);
const noir    = new Noir(circuit, backend);

const { proof, publicInputs } = await noir.generateProof({
  secret_number:        secretNumber.toString(),
  salt:                 poseidonFieldFromBytes(salt),   // Field element BN254
  public_commitment:    poseidonHash(secretNumber, salt),
  number_of_participants: numParticipants,
});
```

> Nota: El contrato Soroban verifica el commitment con SHA-256 (disponible
> directamente en `env.crypto()`). El Noir proof usa Poseidon para la prueba
> formal off-chain. En producción ambos hashes se unifican usando
> `env.crypto().poseidon2_hash()` de Protocol 25.

---

*Built for the Stellar ZK Gaming Hackathon 2026 · MIT License*
