// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
import {getAuth, GoogleAuthProvider} from "firebase/auth"
// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "smartedu-8c002.firebaseapp.com",
  projectId: "smartedu-8c002",
  storageBucket: "smartedu-8c002.firebasestorage.app",
  messagingSenderId: "888002088638",
  appId: "1:888002088638:web:c97073f2968812415c58ef"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider =new GoogleAuthProvider();

export {auth, provider}