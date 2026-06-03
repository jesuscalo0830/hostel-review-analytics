import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyARDxZy2tSoCiePy4I05RTztHqfYs9ctHI",
  authDomain: "hostel-analyzer.firebaseapp.com",
  projectId: "hostel-analyzer",
  storageBucket: "hostel-analyzer.firebasestorage.app",
  messagingSenderId: "928259806921",
  appId: "1:928259806921:web:50e29268fb8408e6d45f18"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export default app;
