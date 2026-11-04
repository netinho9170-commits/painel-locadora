// ============================================================
//  CONFIGURAÇÃO DO PAINEL DA LOCADORA
//  Edite só este arquivo. Siga o passo a passo que recebeu.
// ============================================================
window.LOCADORA_CONFIG = {

  // 1) E-mail do ADMINISTRADOR GERAL (você).
  //    Precisa ser o MESMO e-mail escrito no arquivo firestore.rules.
  adminEmail: "netinho9170@gmail.com",

  // 2) Nome da SUA locadora (aparece no topo quando você entra).
  nomeEmpresa: "Minha Locadora",

  // Chave pública para notificações (Firebase > Cloud Messaging > Certificados push da Web)
  vapidKey: "BDfiYOsimCbs-h06VQK4hMIfj4jro3bpdpi5WADyuWzlw-W1VGSc78iuoXEMPNeuOuPhtjQ73DDzF1Yo7atBCMc",

  // 3) Cole aqui o firebaseConfig do seu projeto Firebase
  //    (Configurações do projeto > Seus apps > App da Web).
  firebase: {
    apiKey: "AIzaSyAUrMctC2H-BAT10sKIMCnGc3r-yJSM2wQ",
    authDomain: "painel-locadora.firebaseapp.com",
    projectId: "painel-locadora",
    storageBucket: "painel-locadora.firebasestorage.app",
    messagingSenderId: "778333072083",
    appId: "1:778333072083:web:cf658a1aa06f775f978226"
  }
};
