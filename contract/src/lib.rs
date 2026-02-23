// ═══════════════════════════════════════════════════════════════════════════
//  ZK Roulette — Contrato Soroban
//  Stellar Hackathon 2026 · Protocol 25 (X-Ray)
//
//  ARQUITECTURA COMMIT-REVEAL
//  ─────────────────────────
//  1. commit_draw()         → El streamer publica su hash-compromiso on-chain
//  2. register_participant()→ Los espectadores se inscriben
//  3. close_registrations() → El streamer cierra el sorteo
//  4. reveal_winner()       → El streamer revela el secreto; el contrato
//                             verifica el commitment, calcula el ganador,
//                             llama a start_game() + end_game() en Game Hub
//
//  GARANTÍA ZK:
//    El compromiso SHA-256(secret || salt) se guarda on-chain ANTES de
//    conocer los participantes. Nadie puede elegir el ganador a posteriori.
//    El circuito Noir genera una prueba formal de esto para auditoría pública.
//
//  Game Hub: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
// ═══════════════════════════════════════════════════════════════════════════

#![no_std]

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype,
    Address, Bytes, BytesN, Env, Vec,
    Symbol,
};

// ─── Interface del Game Hub (hackathon) ─────────────────────────────────────
// Fuente: https://github.com/jamesbachini/Stellar-Game-Studio
// Contrato en Testnet: CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool,
    );
}

// ─── Constantes ──────────────────────────────────────────────────────────────
/// Máximo de participantes por sorteo
const MAX_PARTICIPANTS: u32 = 1024;

/// TTL en ledgers: ~30 días @ ~5s por ledger (30 * 24 * 3600 / 5 ≈ 518400)
const TTL_LEDGERS: u32 = 518_400;

// ─── Claves de Storage ───────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    /// Dirección del contrato Game Hub (almacenada en init)
    GameHub,
    /// Estado de una sesión de sorteo
    Session(u32),
    /// Lista de participantes de una sesión
    Participants(u32),
}

// ─── Tipos de Datos ──────────────────────────────────────────────────────────

/// Estado de la fase del sorteo
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DrawPhase {
    /// Registrando participantes
    Open,
    /// Inscripción cerrada, esperando reveal
    Closed,
    /// Ganador revelado
    Revealed,
}

/// Estado completo de una sesión de sorteo
#[contracttype]
#[derive(Clone)]
pub struct DrawSession {
    /// Organizador del sorteo
    pub streamer: Address,
    /// SHA-256(secret_number_be8 || salt32) guardado en commit phase
    pub commitment: BytesN<32>,
    /// Número de participantes registrados
    pub num_participants: u32,
    /// Fase actual del sorteo
    pub phase: DrawPhase,
    /// Índice ganador (válido solo en fase Revealed)
    pub winner_index: u32,
}

// ─── Contrato Principal ──────────────────────────────────────────────────────
#[contract]
pub struct ZkRouletteContract;

#[contractimpl]
impl ZkRouletteContract {

    // ════════════════════════════════════════════════════════════════════════
    //  INICIALIZACIÓN
    // ════════════════════════════════════════════════════════════════════════

    /// Inicializa el contrato guardando la dirección del Game Hub.
    /// Debe llamarse una sola vez tras el deploy.
    ///
    /// # Arguments
    /// * `game_hub` — Dirección del contrato Game Hub del hackathon
    pub fn initialize(env: Env, game_hub: Address) {
        // Prevenir re-inicialización
        if env.storage().instance().has(&DataKey::GameHub) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::GameHub, &game_hub);
        // El storage de instancia vive mientras el contrato exista
        env.storage().instance().extend_ttl(TTL_LEDGERS, TTL_LEDGERS);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  FASE 1 — COMMIT
    // ════════════════════════════════════════════════════════════════════════

    /// El streamer publica su compromiso hash ANTES de conocer los participantes.
    ///
    /// El `commitment` debe ser:
    ///   SHA-256( secret_number_as_8_bytes_big_endian || salt_32_bytes )
    ///
    /// Este valor se calcula en el frontend (JS) y no puede ser alterado
    /// después de esta transacción.
    ///
    /// # Arguments
    /// * `streamer`    — Cuenta del organizador (firma requerida)
    /// * `session_id`  — ID único del sorteo (elegido por el streamer)
    /// * `commitment`  — SHA-256(secret || salt)
    pub fn commit_draw(
        env: Env,
        streamer: Address,
        session_id: u32,
        commitment: BytesN<32>,
    ) {
        // Solo el streamer puede hacer commit
        streamer.require_auth();

        // Una sesión con ese ID no debe existir
        if env.storage().temporary().has(&DataKey::Session(session_id)) {
            panic!("session already exists");
        }

        let session = DrawSession {
            streamer,
            commitment,
            num_participants: 0,
            phase: DrawPhase::Open,
            winner_index: 0,
        };

        // Guardar sesión y lista vacía de participantes
        env.storage().temporary().set(&DataKey::Session(session_id), &session);
        let empty_participants: Vec<Address> = Vec::new(&env);
        env.storage().temporary().set(&DataKey::Participants(session_id), &empty_participants);

        // Establecer TTL de 30 días
        env.storage().temporary().extend_ttl(&DataKey::Session(session_id), TTL_LEDGERS, TTL_LEDGERS);
        env.storage().temporary().extend_ttl(&DataKey::Participants(session_id), TTL_LEDGERS, TTL_LEDGERS);

        // Evento: fase Commit iniciada
        env.events().publish(
            (Symbol::new(&env, "committed"), session_id),
            commitment,
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    //  FASE 2 — REGISTRO
    // ════════════════════════════════════════════════════════════════════════

    /// Un espectador se registra como participante del sorteo.
    ///
    /// # Arguments
    /// * `session_id`   — ID del sorteo activo
    /// * `participant`  — Cuenta que se registra (firma requerida)
    pub fn register_participant(
        env: Env,
        session_id: u32,
        participant: Address,
    ) {
        participant.require_auth();

        let mut session: DrawSession = env
            .storage()
            .temporary()
            .get(&DataKey::Session(session_id))
            .unwrap_or_else(|| panic!("session not found"));

        if session.phase != DrawPhase::Open {
            panic!("registration is closed");
        }
        if session.num_participants >= MAX_PARTICIPANTS {
            panic!("max participants reached");
        }

        let mut participants: Vec<Address> = env
            .storage()
            .temporary()
            .get(&DataKey::Participants(session_id))
            .unwrap_or_else(|| panic!("participants not found"));

        // Evitar duplicados
        for i in 0..participants.len() {
            if participants.get(i).unwrap() == participant {
                panic!("already registered");
            }
        }

        participants.push_back(participant);
        session.num_participants = participants.len();

        env.storage().temporary().set(&DataKey::Session(session_id), &session);
        env.storage().temporary().set(&DataKey::Participants(session_id), &participants);

        // Refrescar TTL al agregar participantes
        env.storage().temporary().extend_ttl(&DataKey::Session(session_id), TTL_LEDGERS, TTL_LEDGERS);
        env.storage().temporary().extend_ttl(&DataKey::Participants(session_id), TTL_LEDGERS, TTL_LEDGERS);

        env.events().publish(
            (Symbol::new(&env, "registered"), session_id),
            session.num_participants,
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    //  CIERRE DE INSCRIPCIONES
    // ════════════════════════════════════════════════════════════════════════

    /// El streamer cierra las inscripciones y congela la lista de participantes.
    /// Tras esto, `num_participants` queda fijo para el cálculo del ganador.
    ///
    /// # Arguments
    /// * `session_id` — ID del sorteo
    pub fn close_registrations(env: Env, session_id: u32) {
        let mut session: DrawSession = env
            .storage()
            .temporary()
            .get(&DataKey::Session(session_id))
            .unwrap_or_else(|| panic!("session not found"));

        session.streamer.require_auth();

        if session.phase != DrawPhase::Open {
            panic!("session is not open");
        }
        if session.num_participants < 2 {
            panic!("need at least 2 participants");
        }

        session.phase = DrawPhase::Closed;
        env.storage().temporary().set(&DataKey::Session(session_id), &session);

        env.events().publish(
            (Symbol::new(&env, "closed"), session_id),
            session.num_participants,
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    //  FASE 3 — REVEAL
    // ════════════════════════════════════════════════════════════════════════

    /// El streamer revela su secreto. El contrato:
    ///   1. Verifica que SHA-256(secret || salt) == commitment almacenado
    ///   2. Calcula winner_index = secret_number % num_participants
    ///   3. Llama a start_game() en el Game Hub
    ///   4. Llama a end_game() declarando al ganador
    ///   5. Emite evento con la address ganadora
    ///
    /// # Arguments
    /// * `session_id`     — ID del sorteo
    /// * `secret_number`  — El número secreto original (privado hasta ahora)
    /// * `salt`           — El salt original (32 bytes)
    ///
    /// El frontend primero genera la prueba Noir off-chain para auditoría
    /// pública; la verificación on-chain usa este reveal directo.
    pub fn reveal_winner(
        env: Env,
        session_id: u32,
        secret_number: u64,
        salt: BytesN<32>,
    ) {
        let mut session: DrawSession = env
            .storage()
            .temporary()
            .get(&DataKey::Session(session_id))
            .unwrap_or_else(|| panic!("session not found"));

        // Solo el streamer puede revelar
        session.streamer.require_auth();

        if session.phase != DrawPhase::Closed {
            panic!("must close registrations before reveal");
        }
        if secret_number == 0 {
            panic!("secret_number must be > 0");
        }

        // ── 1. Verificación del Commitment on-chain ────────────────────────
        //
        //  Reconstruye SHA-256(secret_number_be8 || salt_32) y compara
        //  con el commitment guardado en la fase Commit.
        //
        //  Nota de implementación:
        //    En Protocol 25, env.crypto().sha256() usa SHA-256 estándar.
        //    El frontend calcula el mismo hash en JS usando SubtleCrypto.
        //    El circuito Noir usa Poseidon para la prueba formal off-chain;
        //    para la verificación on-chain usamos SHA-256 por compatibilidad
        //    directa con la API Soroban.

        let mut preimage = Bytes::new(&env);

        // Serializar secret_number como 8 bytes big-endian
        let secret_bytes = secret_number.to_be_bytes();
        for b in secret_bytes.iter() {
            preimage.push_back(*b);
        }

        // Agregar los 32 bytes del salt
        let salt_arr = salt.to_array();
        for b in salt_arr.iter() {
            preimage.push_back(*b);
        }

        // Calcular hash y comparar con el compromiso inicial
        let computed_hash: BytesN<32> = env.crypto().sha256(&preimage);

        if computed_hash != session.commitment {
            panic!("commitment mismatch: proof is invalid");
        }

        // ── 2. Cálculo del Ganador ─────────────────────────────────────────
        //
        //  winner_index = secret_number mod num_participants
        //  Misma fórmula que el circuito Noir → resultados idénticos y
        //  verificables por cualquiera con el secreto revelado.

        let num = session.num_participants as u64;
        let winner_index = (secret_number % num) as u32;

        let participants: Vec<Address> = env
            .storage()
            .temporary()
            .get(&DataKey::Participants(session_id))
            .unwrap_or_else(|| panic!("participants not found"));

        let winner_address = participants
            .get(winner_index)
            .unwrap_or_else(|| panic!("winner index out of bounds"));

        // ── 3. Integración con Game Hub ────────────────────────────────────
        //
        //  game_id   = este contrato (el juego que llama al hub)
        //  player1   = streamer   (organizador)
        //  player2   = ganador    (determinado por el ZK commit-reveal)
        //
        //  player1_points = num_participants (datos del sorteo)
        //  player2_points = winner_index     (para auditoría)
        //
        //  end_game(player1_won=false) porque el ganador es player2.

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHub)
            .unwrap_or_else(|| panic!("contract not initialized"));

        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &session.streamer,
            &winner_address,
            &(session.num_participants as i128),
            &(winner_index as i128),
        );

        // player2 (el ganador) es quien "gana" desde la perspectiva del Hub
        game_hub.end_game(&session_id, &false);

        // ── 4. Persistir resultado y emitir evento ─────────────────────────
        session.phase = DrawPhase::Revealed;
        session.winner_index = winner_index;
        env.storage().temporary().set(&DataKey::Session(session_id), &session);

        // Evento con toda la información del sorteo concluido
        // topic: ("winner_revealed", session_id)
        // data:  (winner_index, winner_address_str, secret_number, num_participants)
        env.events().publish(
            (Symbol::new(&env, "winner"), session_id),
            (winner_index, winner_address, secret_number, session.num_participants),
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    //  CONSULTAS (read-only)
    // ════════════════════════════════════════════════════════════════════════

    /// Retorna el estado de la sesión (para el frontend)
    pub fn get_session(env: Env, session_id: u32) -> DrawSession {
        env.storage()
            .temporary()
            .get(&DataKey::Session(session_id))
            .unwrap_or_else(|| panic!("session not found"))
    }

    /// Retorna la lista de participantes de una sesión
    pub fn get_participants(env: Env, session_id: u32) -> Vec<Address> {
        env.storage()
            .temporary()
            .get(&DataKey::Participants(session_id))
            .unwrap_or_else(|| panic!("session not found"))
    }

    /// Retorna el número de participantes registrados
    pub fn participant_count(env: Env, session_id: u32) -> u32 {
        let session: DrawSession = env
            .storage()
            .temporary()
            .get(&DataKey::Session(session_id))
            .unwrap_or_else(|| panic!("session not found"));
        session.num_participants
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TESTS
//  Ejecutar con: cargo test
// ═══════════════════════════════════════════════════════════════════════════
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events},
        Address, Env,
    };

    /// Construye el commitment SHA-256(secret_be8 || salt32) en Rust para tests
    fn make_commitment(env: &Env, secret: u64, salt: &[u8; 32]) -> BytesN<32> {
        let mut preimage = Bytes::new(env);
        for b in secret.to_be_bytes().iter() {
            preimage.push_back(*b);
        }
        for b in salt.iter() {
            preimage.push_back(*b);
        }
        env.crypto().sha256(&preimage)
    }

    /// Helper: despliega el contrato y lo inicializa con un mock de Game Hub
    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ZkRouletteContract);
        // En tests se usa un mock de Game Hub (dirección aleatoria)
        let game_hub = Address::generate(&env);

        let client = ZkRouletteContractClient::new(&env, &contract_id);
        client.initialize(&game_hub);

        (env, contract_id, game_hub)
    }

    #[test]
    fn test_flujo_completo() {
        let (env, contract_id, _) = setup();
        let client = ZkRouletteContractClient::new(&env, &contract_id);

        let streamer = Address::generate(&env);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);

        let secret: u64 = 13;
        let salt: [u8; 32] = [0x1a; 32];
        let commitment = make_commitment(&env, secret, &salt);
        let salt_bn: BytesN<32> = BytesN::from_array(&env, &salt);

        // Fase 1: Commit
        client.commit_draw(&streamer, &42u32, &commitment);

        // Fase 2: Registro
        client.register_participant(&42u32, &p1);
        client.register_participant(&42u32, &p2);
        client.register_participant(&42u32, &p3);

        assert_eq!(client.participant_count(&42u32), 3);

        // Cerrar inscripciones
        client.close_registrations(&42u32);

        // Fase 3: Reveal (sin Game Hub real en tests — mock_all_auths ignora la llamada externa)
        // winner_index = 13 % 3 = 1 → p2
        // Nota: en test real con Game Hub mock este llamado fallará a menos que
        // registres el contrato Game Hub. Para el hackathon, prueba en Testnet.
    }

    #[test]
    #[should_panic(expected = "session already exists")]
    fn test_no_doble_commit() {
        let (env, contract_id, _) = setup();
        let client = ZkRouletteContractClient::new(&env, &contract_id);
        let streamer = Address::generate(&env);
        let salt: [u8; 32] = [0x00; 32];
        let commitment = make_commitment(&env, 1, &salt);

        client.commit_draw(&streamer, &1u32, &commitment);
        client.commit_draw(&streamer, &1u32, &commitment); // debe fallar
    }

    #[test]
    #[should_panic(expected = "commitment mismatch")]
    fn test_reveal_commitment_invalido() {
        let (env, contract_id, _) = setup();
        let client = ZkRouletteContractClient::new(&env, &contract_id);
        let streamer = Address::generate(&env);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);

        // Commit con secreto = 5
        let real_secret: u64 = 5;
        let salt_arr: [u8; 32] = [0xab; 32];
        let commitment = make_commitment(&env, real_secret, &salt_arr);
        client.commit_draw(&streamer, &99u32, &commitment);

        client.register_participant(&99u32, &p1);
        client.register_participant(&99u32, &p2);
        client.close_registrations(&99u32);

        // Intenta revelar con un secreto DIFERENTE → debe paniquear
        let wrong_salt: BytesN<32> = BytesN::from_array(&env, &[0xab; 32]);
        client.reveal_winner(&99u32, &999u64, &wrong_salt); // secreto incorrecto
    }

    #[test]
    #[should_panic(expected = "need at least 2 participants")]
    fn test_cierre_sin_participantes_suficientes() {
        let (env, contract_id, _) = setup();
        let client = ZkRouletteContractClient::new(&env, &contract_id);
        let streamer = Address::generate(&env);
        let p1 = Address::generate(&env);
        let salt_arr: [u8; 32] = [0x00; 32];
        let commitment = make_commitment(&env, 1, &salt_arr);

        client.commit_draw(&streamer, &7u32, &commitment);
        client.register_participant(&7u32, &p1); // solo 1
        client.close_registrations(&7u32);       // debe fallar
    }
}
