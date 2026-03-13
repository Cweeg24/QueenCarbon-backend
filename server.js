require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const mqtt = require("mqtt");

const app = express();
// O CORS permite que o seu aplicativo Expo consiga acessar essa API sem bloqueios
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
    // Conecta ao banco uma única vez na inicialização
    await mongoClient.connect();
    console.log("✅ Conectado ao MongoDB Atlas!");
    
    const db = mongoClient.db("queencarbon"); // Nome do seu banco de dados
    collection = db.collection("sensores");   // Nome da sua tabela/coleção

    // ==========================================
    // 2. CONFIGURAÇÃO DO MQTT (HIVEMQ)
    // ==========================================
    const mqttClient = mqtt.connect({
      host: process.env.MQTT_HOST, // ex: 6f3e3564d0db4e47bf46de2604969c44.s1.eu.hivemq.cloud
      port: 8883,
      protocol: "mqtts",
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
    });

    mqttClient.on("connect", () => {
      console.log("✅ Conectado ao HiveMQ!");
      // O "#" é o curinga. Ele vai escutar temperatura, umidade, nivel e luminosidade de uma vez só!
      mqttClient.subscribe("tanque1/#"); 
    });

    mqttClient.on("message", async (topic, message) => {
      const msgCrua = message.toString();
      const valor = parseFloat(msgCrua);

      // O tópico chega assim: "tanque1/temperatura_externa"
      // Vamos dividir para saber de qual tanque e qual sensor veio
      const partes = topic.split("/");
      const tanque = partes[0];
      const sensor = partes[1];

      if (!isNaN(valor)) {
        // Salva no banco de dados!
        await collection.insertOne({
          tanque: tanque,
          sensor: sensor,
          valor: valor,
          data: new Date(),
        });
        console.log(`💾 Salvo no banco -> ${sensor}: ${valor}`);
      } else {
        console.log(`⚠️ Valor inválido recebido no tópico ${topic}`);
      }
    });

    // ==========================================
    // 3. API PARA O APLICATIVO EXPO (ROTAS)
    // ==========================================
    
    // Essa rota pega o ÚLTIMO valor de cada sensor para montar o painel principal do app
    app.get("/api/status/:tanque", async (req, res) => {
      try {
        const tanqueId = req.params.tanque;
        const sensores = ['temperatura_externa', 'umidade_ar', 'nivel', 'luminosidade'];
        const resposta = {};

        // Faz uma busca rápida no banco para cada sensor pegando só o registro mais recente
        for (let s of sensores) {
          const ultimoDado = await collection
            .find({ tanque: tanqueId, sensor: s })
            .sort({ data: -1 })
            .limit(1)
            .toArray();

          resposta[s] = ultimoDado.length > 0 ? ultimoDado[0].valor : 0;
        }

        res.json(resposta);
      } catch (e) {
        console.error("Erro na API:", e);
        res.status(500).json({ erro: "Erro ao buscar dados do banco" });
      }
    });

    // Inicia o servidor Express
    app.listen(PORT, () => {
      console.log(`🚀 API do Queen Carbon rodando na porta ${PORT}`);
    });

  } catch (error) {
    console.error("❌ Erro fatal ao iniciar o servidor:", error);
  }
}

// Roda a função principal
iniciarServidor();