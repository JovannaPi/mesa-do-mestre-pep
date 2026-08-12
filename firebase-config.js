import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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
const campaignDocRef = doc(db, "campaign", "main");
// Documento separado e pequeno, só com o que muda toda hora durante o jogo (posição dos
// marcadores no mapa). Arrastar um marcador não deveria reenviar a campanha inteira
// (NPCs, itens, texto da aventura...) pro Firestore — era isso que deixava o mapa lento.
const liveDocRef = doc(db, "campaign", "live");

export async function loadCloudState() {
  try {
    const snap = await getDoc(campaignDocRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Não foi possível carregar do Firestore (seguindo com dados locais):", err);
    return null;
  }
}

export async function saveCloudState(state) {
  try {
    await setDoc(campaignDocRef, state);
    return true;
  } catch (err) {
    console.warn("Não foi possível salvar no Firestore (dados continuam salvos localmente):", err);
    return false;
  }
}

// Assinatura em tempo real — usada pela página dos jogadores (e pelo polling leve do mapa
// no lado da Mestra) para refletir mudanças sem precisar recarregar a página.
export function subscribeToState(onChange, onError) {
  return onSnapshot(
    campaignDocRef,
    (snap) => {
      if (snap.exists()) onChange(snap.data());
    },
    (err) => {
      console.warn("Assinatura do Firestore perdida:", err);
      if (onError) onError(err);
    }
  );
}

export async function loadLiveState() {
  try {
    const snap = await getDoc(liveDocRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Não foi possível carregar a posição ao vivo do mapa:", err);
    return null;
  }
}

export async function saveLiveState(liveData) {
  try {
    await setDoc(liveDocRef, liveData);
    return true;
  } catch (err) {
    console.warn("Não foi possível salvar a posição ao vivo do mapa:", err);
    return false;
  }
}

export function subscribeToLiveState(onChange, onError) {
  return onSnapshot(
    liveDocRef,
    (snap) => {
      if (snap.exists()) onChange(snap.data());
    },
    (err) => {
      console.warn("Assinatura ao vivo do mapa perdida:", err);
      if (onError) onError(err);
    }
  );
}
