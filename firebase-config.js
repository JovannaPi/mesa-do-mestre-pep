import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUmeVOh621La9m6eTx5vH2vBPfJN3Pu6k",
  authDomain: "mesa-do-mestre-pep.firebaseapp.com",
  projectId: "mesa-do-mestre-pep",
  storageBucket: "mesa-do-mestre-pep.firebasestorage.app",
  messagingSenderId: "156188376888",
  appId: "1:156188376888:web:8961bae5fa8c481d2d4bcd",
  measurementId: "G-0SV10RP5GW",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Login anônimo automático — sem tela, sem senha, ninguém percebe que existe. Isso é o
// que permite trocar a regra do Firestore de "qualquer um pode ler/escrever" (aberto pra
// qualquer bot que vasculhe a internet) para "só quem carregou o app de verdade". Precisa
// que "Anonymous" esteja ativado em Firebase Console → Authentication → Sign-in method,
// senão o login falha silenciosamente e o app cai de volta pro modo só-local.
const auth = getAuth(app);
const authReady = new Promise((resolve) => {
  const unsub = onAuthStateChanged(auth, (user) => {
    if (user) {
      unsub();
      resolve(user);
    }
  });
  signInAnonymously(auth).catch((err) => {
    console.warn("Login anônimo no Firebase falhou (ative 'Anonymous' em Authentication → Sign-in method):", err);
  });
});

// Um documento por Mesa (campanha independente), em vez do antigo caminho fixo
// "campaign/main" — assim várias Mesas sincronizam cada uma pro seu próprio lugar,
// sem misturar dado de uma Mesa na outra.
function campaignDocRef(mesaId) {
  return doc(db, "mesas", mesaId);
}
// Documento separado e pequeno, só com o que muda toda hora durante o jogo (posição dos
// marcadores no mapa). Arrastar um marcador não deveria reenviar a campanha inteira
// (NPCs, itens, texto da aventura...) pro Firestore — era isso que deixava o mapa lento.
function liveDocRef(mesaId) {
  return doc(db, "mesas", mesaId, "estado", "live");
}

// Espera o login anônimo, mas nunca trava pra sempre: se "Anonymous" ainda não estiver
// ativado no console (ou a rede estiver ruim), segue em frente depois de um tempo — a
// tentativa de leitura/escrita vai falhar (regras exigem auth) e cai no fallback local
// que já existe em cada função abaixo, em vez de travar o app esperando um login que
// nunca chega.
function authReadyOrTimeout() {
  return Promise.race([authReady, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

export async function loadCloudState(mesaId) {
  try {
    await authReadyOrTimeout();
    const snap = await getDoc(campaignDocRef(mesaId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Não foi possível carregar do Firestore (seguindo com dados locais):", err);
    return null;
  }
}

// Escrita parcial usada pela tela da jogadora pra editar o próprio inventário — atualiza
// só o campo "pcs" no Firestore (em vez de reescrever a campanha inteira, como saveCloudState
// faz), pra não ter risco de apagar uma mudança que a Mestra tenha feito em outra parte do
// estado ao mesmo tempo.
export async function savePcs(mesaId, pcs) {
  try {
    await authReadyOrTimeout();
    await updateDoc(campaignDocRef(mesaId), { pcs });
    return true;
  } catch (err) {
    console.warn("Não foi possível salvar o inventário no Firestore:", err);
    return false;
  }
}

export async function saveCloudState(mesaId, state) {
  try {
    await authReadyOrTimeout();
    await setDoc(campaignDocRef(mesaId), state);
    return true;
  } catch (err) {
    console.warn("Não foi possível salvar no Firestore (dados continuam salvos localmente):", err);
    return false;
  }
}

// Assinatura em tempo real — usada pela página dos jogadores (e pelo polling leve do mapa
// no lado da Mestra) para refletir mudanças sem precisar recarregar a página. Espera o
// login anônimo antes de assinar, mas devolve a função de cancelar na hora (síncrono),
// sem virar Promise — quem chama não precisa mudar nada.
export function subscribeToState(mesaId, onChange, onError) {
  let liveUnsub = null;
  let cancelled = false;
  authReadyOrTimeout().then(() => {
    if (cancelled) return;
    liveUnsub = onSnapshot(
      campaignDocRef(mesaId),
      (snap) => {
        if (snap.exists()) onChange(snap.data());
      },
      (err) => {
        console.warn("Assinatura do Firestore perdida:", err);
        if (onError) onError(err);
      }
    );
  });
  return () => {
    cancelled = true;
    if (liveUnsub) liveUnsub();
  };
}

export async function loadLiveState(mesaId) {
  try {
    await authReadyOrTimeout();
    const snap = await getDoc(liveDocRef(mesaId));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Não foi possível carregar a posição ao vivo do mapa:", err);
    return null;
  }
}

export async function saveLiveState(mesaId, liveData) {
  try {
    await authReadyOrTimeout();
    await setDoc(liveDocRef(mesaId), liveData);
    return true;
  } catch (err) {
    console.warn("Não foi possível salvar a posição ao vivo do mapa:", err);
    return false;
  }
}

export function subscribeToLiveState(mesaId, onChange, onError) {
  let liveUnsub = null;
  let cancelled = false;
  authReadyOrTimeout().then(() => {
    if (cancelled) return;
    liveUnsub = onSnapshot(
      liveDocRef(mesaId),
      (snap) => {
        if (snap.exists()) onChange(snap.data());
      },
      (err) => {
        console.warn("Assinatura ao vivo do mapa perdida:", err);
        if (onError) onError(err);
      }
    );
  });
  return () => {
    cancelled = true;
    if (liveUnsub) liveUnsub();
  };
}
