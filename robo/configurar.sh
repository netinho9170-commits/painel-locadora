#!/bin/bash
# Configura o acesso do robô (GitHub Actions) ao Firebase SEM chave secreta,
# usando Workload Identity Federation. Rodar uma vez no Cloud Shell.
set -e
P=painel-locadora
NUM=778333072083
REPO=netinho9170-commits/painel-locadora
SA=giro-avisos@$P.iam.gserviceaccount.com

gcloud config set project $P
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com fcm.googleapis.com firestore.googleapis.com

gcloud iam service-accounts describe $SA >/dev/null 2>&1 || \
  gcloud iam service-accounts create giro-avisos --display-name="Giro Frota - robo de avisos"

# Ler/limpar dados no Firestore e enviar notificações
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role=roles/datastore.user --condition=None -q >/dev/null
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role=roles/firebasecloudmessaging.admin --condition=None -q >/dev/null

gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --display-name="GitHub Actions" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$REPO'"

# Só o repositório do Giro Frota pode usar a conta do robô
gcloud iam service-accounts add-iam-policy-binding $SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" -q >/dev/null

echo "CONFIGURADO-OK"
