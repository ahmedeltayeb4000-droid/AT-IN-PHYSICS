import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA30E9clxpZoxxdQ0yVWszEZy8B36_Qw-E",
  authDomain: "at-in-physics.firebaseapp.com",
  projectId: "at-in-physics",
  storageBucket: "at-in-physics.firebasestorage.app",
  messagingSenderId: "442151522952",
  appId: "1:442151522952:web:a467bb5b5cdf8fac88453d",
  measurementId: "G-LMDDSS3BR2"
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
