FROM node:24-bookworm-slim
WORKDIR /app
RUN chown node:node /app
USER node

ENV NEXT_TELEMETRY_DISABLED=1

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ARG NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER=""
ENV NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER=$NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER

RUN npm run lint && npm run build

ENV NODE_ENV=production
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
