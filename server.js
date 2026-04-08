require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const mqtt = require("mqtt");

const app = express();
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

    // ==========================================
    // 2. CONFIGURAÇÃO DO MQTT (HIVEMQ)
    // ==========================================
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
      // Força o tópico a ser String para evitar qualquer erro de tipo
      const topicoString = String(topic);
      
      if (topicoString.includes("comando") || !collection) return;

      const valor = parseFloat(message.toString());
      const partes = topicoString.split("/");

      if (partes.length >= 2 && !isNaN(valor)) {
        // SUBSTITUTO DO TRIM: Transforma em string, remove todos os espaços e deixa minúsculo
        const tanque = String(partes).replace(/\s+/g, '').toLowerCase();
        const sensor = String(partes).replace(/\s+/g, '').toLowerCase();

        await collection.insertOne({
          tanque: tanque,
          sensor: sensor,
          valor: valor,
          data: new Date(),
        });
        console.log(`💾 Sensor: [${tanque}] ${sensor} = ${valor}`);
      }
    });

    // ==========================================
    // 3. ROTAS DA API (MONITORAMENTO E COMANDO)
    // ==========================================
    
    app.get("/api/ping", (req, res) => res.send("Queen Carbon Online! 🚀"));

    // MONITORAMENTO
    app.get("/api/status/:tanque", async (req, res) => {
      try {
        // SUBSTITUTO DO TRIM NAS ROTAS
        const tanqueId = String(req.params.tanque).replace(/\s+/g, '').toLowerCase();
        const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
        const resposta = {};

        for (let s of sensores) {
          const ultimoDado = await collection
            .find({ tanque: tanqueId, sensor: s })
            .sort({ data: -1 })
            .limit(1)
            .toArray();

          resposta[s] = ultimoDado.length > 0 ? ultimoDado.valor : 0;
        }
        res.json(resposta);
      } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar dados" });
      }
    });

    // CONTROLE (RELÉS)
    app.post("/api/comando/:tanque", (req, res) => {
      const { dispositivo, estado } = req.body;
      const tanqueId = String(req.params.tanque).replace(/\s+/g, '').toLowerCase();
      
      const topico = `${tanqueId}/comando/${dispositivo}`;
      mqttClient.publish(topico, String(estado), { qos: 1 });
      
      console.log(`📤 Comando enviado: ${topico} -> ${estado}`);
      res.json({ status: "sucesso", enviado: topico });
    });

    app.listen(PORT, () => {
      console.log(`🚀 API Queen Carbon na porta ${PORT}`);
    });

  } catch (error) {
    console.error("❌ Erro fatal:", error);
  }
}

iniciarServidor();