FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=https://api.clinicos.id
ARG REACT_APP_PUBLIC_UPLOAD_BASE_URL=
ARG REACT_APP_APP_ENV=production
ARG REACT_APP_BETA_MODE=

ENV REACT_APP_BACKEND_URL=${VITE_API_BASE_URL}
ENV REACT_APP_PUBLIC_UPLOAD_BASE_URL=${REACT_APP_PUBLIC_UPLOAD_BASE_URL}
ENV REACT_APP_APP_ENV=${REACT_APP_APP_ENV}
ENV REACT_APP_BETA_MODE=${REACT_APP_BETA_MODE}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
