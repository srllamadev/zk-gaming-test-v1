# ZK Roulette — Circuito Noir

## Estructura

```
circuits/
├── Nargo.toml        # Manifiesto del proyecto Noir
├── Prover.toml       # Valores de prueba (dev only, git-ignored en prod)
└── src/
    └── main.nr       # Circuito ZK principal
```

## Requisitos

- [Noir](https://noir-lang.org/docs/getting_started/quick_start) `>= 0.36.0`
- [Nargo](https://noir-lang.org/docs/getting_started/installation/) (CLI de Noir)

```bash
# Instalar con noirup
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup
```

## Comandos

```bash
# Compilar el circuito → genera /target/zk_roulette.json
nargo compile

# Ejecutar tests integrados
nargo test

# Generar una prueba (requiere Prover.toml con valores válidos)
nargo prove

# Verificar la prueba generada
nargo verify

# Inspeccionar la ABI del circuito (útil para el frontend)
cat target/zk_roulette.json | jq '.abi'
```

## Esquema Commit-Reveal

```
FASE 1 — COMMIT (antes de iniciar el sorteo)
┌─────────────────────────────────────────────────────────────┐
│  Frontend genera:                                           │
│    secret_number = crypto.getRandomValues()                 │
│    salt          = crypto.getRandomValues()                 │
│    commitment    = Poseidon(secret_number, salt)            │
│                                                             │
│  → Envía commitment al contrato Soroban (commit_draw)       │
│  → Guarda (secret_number, salt) en localStorage cifrado     │
└─────────────────────────────────────────────────────────────┘

FASE 2 — PARTICIPANTES (sorteo abierto)
┌─────────────────────────────────────────────────────────────┐
│  Los espectadores se registran on-chain.                    │
│  number_of_participants queda registrado al cerrar.         │
└─────────────────────────────────────────────────────────────┘

FASE 3 — REVEAL (el streamer "gira la ruleta")
┌─────────────────────────────────────────────────────────────┐
│  Frontend recupera (secret_number, salt) de localStorage    │
│  Genera ZK proof via Noir.js (WASM en el browser):          │
│    - Inputs privados:  secret_number, salt                  │
│    - Inputs públicos:  commitment (on-chain), participants   │
│    - Output público:   winner_index                         │
│                                                             │
│  → Envía proof + public_inputs al contrato (reveal_winner)  │
│  → Contrato verifica on-chain y emite evento con ganador    │
└─────────────────────────────────────────────────────────────┘
```

## Garantías de Seguridad

| Propiedad | Garantía |
|-----------|----------|
| **Binding** | El streamer no puede cambiar el secreto tras hacer commit |
| **Hiding** | El secreto no se revela hasta el ZK proof |
| **Fairness** | El ganador es determinístico e inmanipulable |
| **Verifiability** | Cualquiera puede verificar la prueba on-chain |
| **No-trusted setup** | Noir/Barretenberg usa UltraPlonk (sin SRS por rol) |
