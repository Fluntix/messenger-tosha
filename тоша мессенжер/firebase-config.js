// Firebase конфигурация (ваша)
const firebaseConfig = {
  apiKey: "AIzaSyBwZzHPp_EXtg098oNi2vUZq8sNMdtngD0",
  authDomain: "toshasites.firebaseapp.com",
  databaseURL: "https://toshasites-default-rtdb.firebaseio.com",
  projectId: "toshasites",
  storageBucket: "toshasites.firebasestorage.app",
  messagingSenderId: "17855738927",
  appId: "1:17855738927:web:6c2cfa372ce6dbc083c2da",
  measurementId: "G-3VRFPSLZPR"
};

// Инициализация Firebase (для всех страниц)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// Вспомогательная функция генерации резервного кода
function generateBackupCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}