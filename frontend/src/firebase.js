import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);

isSupported().then((ok) => {
  if (ok) getAnalytics(app);
});

export { app, auth, storage };
