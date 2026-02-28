import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyB3lnABSQeuzvdNe5pAReA2feiGEW-gR9A",
  authDomain: "verifity-ai.firebaseapp.com",
  projectId: "verifity-ai",
  storageBucket: "verifity-ai.firebasestorage.app",
  messagingSenderId: "498079762864",
  appId: "1:498079762864:web:bf11840a656f03a0202e75",
  measurementId: "G-W71DMXMKKR",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

isSupported().then((ok) => {
  if (ok) getAnalytics(app);
});

export { app, auth };
