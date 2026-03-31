require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const mqtt = require("mqtt");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. CONFIGURAÇÃO DO MONGODB
// ==========================================
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
    });

    mqttClient.on("message", async (topic, message) => {
      const msgCrua = message.toString();
      const valor = parseFloat(msgCrua);

      const partes = topic.split("/");
      const tanque = partes;
      const sensor = partes;

      if (!isNaN(valor)) {
        await collection.insertOne({
          tanque: tanque,
          sensor: sensor,
          valor: valor,
          data: new Date(),
        });
        console.log(`💾 Salvo -> ${sensor}: ${valor}`);
      }
    });

    // ==========================================
    // 3. API PARA O APLICATIVO EXPO (ROTAS)
    // ==========================================
    
    // ROTA ATUAL: Pega o último valor (Para os ponteiros/cards)
    app.get("/api/status/:tanque", async (req, res) => {
      try {
        const tanqueId = req.params.tanque;
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
        res.status(500).json({ erro: "Erro ao buscar status" });
      }
    });

    // --- NOVA ROTA: HISTÓRICO (Para o Gráfico) ---
    app.get("/api/historico/:tanque", async (req, res) => {
      try {
        const tanqueId = req.params.tanque;

        // Busca os últimos 40 registros gerais do tanque
        const dadosBrutos = await collection
          .find({ tanque: tanqueId })
          .sort({ data: -1 })
          .limit(40)
          .toArray();

        // Mapeia os dados para o formato que o gráfico entende
        // Ex: { temperatura_externa: 25, timestamp: "2024-..." }
        const historicoFormatado = dadosBrutos.map(d => ({
          [d.sensor]: d.valor, // Cria a chave com o nome do sensor (ex: temperatura_externa)
          timestamp: d.data,
          sensor: d.sensor     // mantemos essa chave para o filtro do App
        }));

        // Invertemos para que o gráfico mostre do mais antigo para o mais novo
        res.json(historicoFormatado.reverse());
      } catch (e) {
        console.error("Erro na rota de histórico:", e);
        res.status(500).json({ erro: "Erro ao buscar histórico" });
      }
    });

    app.listen(PORT, () => {
      console.log(`🚀 API do Queen Carbon rodando na porta ${PORT}`);
    });

  } catch (error) {
    console.error("❌ Erro fatal ao iniciar o servidor:", error);
  }
}

iniciarServidor();