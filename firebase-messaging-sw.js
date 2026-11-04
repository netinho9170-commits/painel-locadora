// Recebe as notificações do Giro Frota com o app fechado.
// O próprio Firebase mostra a notificação e abre o app ao tocar (link enviado pelo robô).
self.window = self;
importScripts('config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp(self.LOCADORA_CONFIG.firebase);
firebase.messaging();
