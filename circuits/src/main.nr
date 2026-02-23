// ═══════════════════════════════════════════════════════════════════════════
//  ZK Roulette for Streamers — Circuito Principal
//  Protocolo: Commit-Reveal con Provable Randomness
//  Hash:      Poseidon over BN254 (compatible con Stellar Protocol 25)
//
//  FLUJO:
//    COMMIT  → El streamer genera (secret_number, salt) localmente,
//              calcula commitment = Poseidon(secret_number, salt) y
//              lo almacena on-chain. El secreto NUNCA sale del cliente.
//
//    REVEAL  → Tras cerrar inscripciones, el streamer genera una prueba
//              ZK que demuestra:
//                1. Conoce el preimage del commitment.
//                2. El ganador = secret_number % number_of_participants
//              La prueba se verifica on-chain en el contrato Soroban.
//
//  ENTRADAS PRIVADAS (solo el Prover las ve):
//    · secret_number  — número aleatorio generado por el streamer
//    · salt           — valor extra para evitar ataques de fuerza bruta
//
//  ENTRADAS PÚBLICAS (visibles on-chain y por cualquiera):
//    · public_commitment      — Poseidon(secret_number, salt) guardado on-chain
//    · number_of_participants — total de participantes registrados on-chain
//
//  SALIDA PÚBLICA:
//    · winner_index — índice del ganador (0-based)
// ═══════════════════════════════════════════════════════════════════════════

use dep::std::hash::poseidon;

// ─── Constante de seguridad ──────────────────────────────────────────────────
// Número máximo de participantes que el circuito puede manejar.
// Aumentar si el streamer espera más de 1024 participantes.
global MAX_PARTICIPANTS: u64 = 1024;

// ─── Circuito Principal ──────────────────────────────────────────────────────
fn main(
    // ── Entradas PRIVADAS (witness) ──────────────────────────────────────────
    secret_number: u64,   // El número secreto del streamer (p.ej. 0..2^32)
    salt: Field,          // Salt aleatorio para proteger contra brute-force

    // ── Entradas PÚBLICAS (verificables por cualquiera) ──────────────────────
    public_commitment: pub Field, // Hash almacenado on-chain en la fase Commit
    number_of_participants: pub u64, // Participantes registrados al cerrar sorteo

) -> pub u64 {

    // ── 1. Validaciones de integridad ────────────────────────────────────────

    // Debe haber al menos 2 participantes para que el sorteo tenga sentido.
    assert(number_of_participants >= 2, "Se necesitan al menos 2 participantes");

    // No superar el límite del circuito.
    assert(
        number_of_participants <= MAX_PARTICIPANTS,
        "Supera el maximo de participantes del circuito"
    );

    // El secret_number debe ser mayor que 0 para evitar salidas predecibles.
    assert(secret_number > 0, "secret_number debe ser mayor que cero");

    // ── 2. Reconstrucción del Commitment ────────────────────────────────────
    //
    //  Convertimos secret_number a Field para usar Poseidon.
    //  Poseidon es la función de hash ZK-friendly que Stellar Protocol 25
    //  integra nativamente, lo que permite verificación eficiente on-chain.
    //
    let secret_as_field: Field = secret_number as Field;

    // Poseidon hash de 2 entradas: [secret_number_field, salt]
    //   · Produce un único elemento de campo BN254.
    //   · Binding y hiding: no se puede invertir ni predecir sin (secret, salt).
    let computed_commitment: Field = poseidon::bn254::hash_2([secret_as_field, salt]);

    // ── 3. Verificación del Commitment (corazón del ZK proof) ────────────────
    //
    //  Esta aserción es la garantía del contrato social del sorteo:
    //  "El número que uso para calcular el ganador es EXACTAMENTE el mismo
    //   que comprometí on-chain ANTES de conocer los participantes."
    //
    //  Si esta aserción falla, la prueba ZK es inválida y el contrato
    //  Soroban rechazará la transacción automáticamente.
    //
    assert(
        computed_commitment == public_commitment,
        "El commitment no coincide: el secreto fue alterado"
    );

    // ── 4. Cálculo del Ganador ───────────────────────────────────────────────
    //
    //  winner_index = secret_number mod number_of_participants
    //
    //  Esto garantiza:
    //  · Distribución uniforme si secret_number es aleatorio.
    //  · El resultado es determinístico dado el secreto.
    //  · El streamer NO podía elegir el ganador a posteriori.
    //
    let winner_index: u64 = secret_number % number_of_participants;

    // El índice ganador es la única salida pública del circuito.
    // El contrato Soroban lo leerá del public_inputs del proof.
    winner_index
}

// ═══════════════════════════════════════════════════════════════════════════
//  TESTS  — ejecutar con: nargo test
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_sorteo_basico() {
    // Escenario: 5 participantes, secreto = 13
    // Ganador esperado: 13 % 5 = 3
    let secret: u64 = 13;
    let salt: Field = 0x1a2b3c4d5e6f;
    let participants: u64 = 5;

    let commitment = poseidon::bn254::hash_2([secret as Field, salt]);
    let winner = main(secret, salt, commitment, participants);

    assert(winner == 3);
}

#[test]
fn test_sorteo_un_solo_ganador_posible() {
    // Escenario: 2 participantes, secreto par → ganador = 0
    let secret: u64 = 100;
    let salt: Field = 0xdeadbeef;
    let participants: u64 = 2;

    let commitment = poseidon::bn254::hash_2([secret as Field, salt]);
    let winner = main(secret, salt, commitment, participants);

    assert(winner == 0); // 100 % 2 = 0
}

#[test]
fn test_commitment_correcto_siempre_pasa() {
    // El mismo secreto + salt siempre produce el mismo ganador (determinismo)
    let secret: u64 = 999888777;
    let salt: Field = 0xcafe1234;
    let participants: u64 = 10;

    let commitment = poseidon::bn254::hash_2([secret as Field, salt]);

    let winner_a = main(secret, salt, commitment, participants);
    let winner_b = main(secret, salt, commitment, participants);

    assert(winner_a == winner_b);
    assert(winner_a == (999888777 % 10) as u64); // = 7
}

#[test(should_fail_with = "El commitment no coincide: el secreto fue alterado")]
fn test_commitment_incorrecto_falla() {
    // Un commitment falso debe hacer fallar la prueba
    let secret: u64 = 42;
    let salt: Field = 0x1111;
    let fake_commitment: Field = 0x9999; // ← compromiso inventado
    let participants: u64 = 8;

    // Esta llamada DEBE fallar con la aserción del commitment
    let _winner = main(secret, salt, fake_commitment, participants);
}

#[test(should_fail_with = "Se necesitan al menos 2 participantes")]
fn test_un_participante_falla() {
    let secret: u64 = 77;
    let salt: Field = 0xabcd;
    let commitment = poseidon::bn254::hash_2([77 as Field, 0xabcd]);
    let _winner = main(secret, salt, commitment, 1); // ← debe fallar
}
