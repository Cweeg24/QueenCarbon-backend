require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const mqtt = require("mqtt");

const app = express();

// Configuração de CORS para permitir que o App fale com o Servidor sem bloqueios
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const mongoClient = new MongoClient(process.env.MONGO_URI);
let collection;

async function iniciarServidor() {
  try {
    await mongoClient.connect();
    console.log("✅ Conectado ao MongoDB Atlas!");
    const db = mongoClient.db("queencarbon");
    collection = db.collection("sensores");

    const mqttClient = mqtt.connect({
      host: process.env.MQTT_HOST,
      port: 8883,
      protocol: "mqtts",
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
    });

    mqttClient.on("connect", () => {
      console.log("✅ Conectado ao HiveMQ!");
      mqttClient.subscribe("tanque1/#");
      mqttClient.subscribe("tanque2/#");
    });

    mqttClient.on("message", async (topic, message) => {
      if (topic.includes("comando")) return;
      const valor = parseFloat(message.toString());
      const partes = topic.split("/");
      const tanque = partes;
      const sensor = partes;
      if (!isNaN(valor)) {
        await collection.insertOne({ tanque, sensor, valor, data: new Date() });
      }
    });

    // --- ROTAS ---

    app.get("/api/status/:tanque", async (req, res) => {
      const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
      const resposta = {};
      for (let s of sensores) {
        const ultimo = await collection.find({ tanque: req.params.tanque, sensor: s }).sort({ data: -1 }).limit(1).toArray();
        resposta[s] = ultimo.length > 0 ? ultimo.valor : 0;
      }
      res.json(resposta);
    });

    app.get("/api/historico/:tanque", async (req, res) => {
      const dados = await collection.find({ tanque: req.params.tanque }).sort({ data: -1 }).limit(40).toArray();
      res.json(dados.reverse());
    });

    // ROTA DE COMANDO (POST - Para o Aplicativo)
    app.post("/api/comando/:tanque", (req, res) => {
      const { dispositivo, estado } = req.body;
      const topico = `${req.params.tanque}/comando/${dispositivo}`;
      mqttClient.publish(topico, estado.toString(), { qos: 1 });
      console.log(`📤 [POST] Comando: ${topico} -> ${estado}`);
      res.json({ status: "ok", enviado: topico });
    });

    // --- ROTA DE TESTE (GET - Para você testar no Navegador) ---
    // Digite no navegador: .../api/teste/tanque1/luz/1
    app.get("/api/teste/:tanque/:dispositivo/:estado", (req, res) => {
      const { tanque, dispositivo, estado } = req.params;
      const topico = `${tanque}/comando/${dispositivo}`;
      mqttClient.publish(topico, estado.toString(), { qos: 1 });
      console.log(`📤 [GET TESTE] Comando: ${topico} -> ${estado}`);
      res.send(`<h1>Comando Enviado!</h1><p>Tópico: ${topico}</p><p>Estado: ${estado}</p>`);
    });

    app.listen(PORT, () => console.log(`🚀 API Queen Carbon na porta ${PORT}`));

  } catch (error) {
    console.error("❌ Erro fatal:", error);
  }
}
iniciarServidor();