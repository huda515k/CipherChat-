const mongoose = require('./server/node_modules/mongoose');
const KeyExchange = require('./server/models/KeyExchange');

async function clearCorruptedKeyExchanges() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/e2ee_messaging';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Delete all PENDING and FAILED key exchanges
    const result = await KeyExchange.deleteMany({ 
      status: { $in: ['PENDING', 'FAILED'] } 
    });
    
    console.log(`✅ Deleted ${result.deletedCount} corrupted key exchanges`);
    
    // Also delete expired ones
    const expiredResult = await KeyExchange.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    
    console.log(`✅ Deleted ${expiredResult.deletedCount} expired key exchanges`);
    
    console.log(`✅ Total cleaned: ${result.deletedCount + expiredResult.deletedCount} key exchanges`);
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing key exchanges:', error);
    process.exit(1);
  }
}

clearCorruptedKeyExchanges();

