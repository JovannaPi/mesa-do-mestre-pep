import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
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
