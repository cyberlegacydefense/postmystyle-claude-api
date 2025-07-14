const axios = require('axios');

// Import the main UGC monitor function
const { handler: ugcMonitorHandler } = require('./ugc-monitor');

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('⏰ Scheduled UGC Monitor triggered at:', new Date().toISOString());

  // Add scheduled execution metadata to the event
  const scheduledEvent = {
    ...event,
    isScheduled: true,
    scheduledAt: new Date().toISOString(),
    triggerType: 'cron'
  };

  try {
    // Call the main UGC monitoring function
    console.log('🔄 Executing main UGC monitor...');
    const result = await ugcMonitorHandler(scheduledEvent, context);

    const executionTime = Date.now() - startTime;
    console.log(`⏰ Scheduled UGC monitoring completed in ${executionTime}ms`);

    // Parse the result to log key metrics
    if (result.body) {
      try {
        const resultData = JSON.parse(result.body);
        console.log(`📊 Scheduled run results: ${resultData.newDiscoveries || 0} new discoveries, ${resultData.sessionsCorrelated || 0} sessions correlated`);

        // Add scheduled execution metadata to the response
        const enhancedResult = {
          ...resultData,
          isScheduledExecution: true,
          scheduledAt: scheduledEvent.scheduledAt,
          totalExecutionTimeMs: executionTime
        };

        return {
          statusCode: result.statusCode,
          headers: result.headers,
          body: JSON.stringify(enhancedResult)
        };

      } catch (parseError) {
        console.warn('⚠️ Could not parse UGC monitor result for logging');
      }
    }

    return result;

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('❌ Scheduled UGC monitoring failed:', error);

    // Send critical alert for scheduled failure
    await sendScheduledFailureAlert(error, executionTime);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        isScheduledExecution: true,
        scheduledAt: scheduledEvent.scheduledAt,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString()
      })
    };
  }
};

async function sendScheduledFailureAlert(error, executionTime) {
  const webhookUrl = process.env.MONITORING_ALERT_WEBHOOK;

  if (!webhookUrl) {
    console.log('⚠️ No monitoring webhook configured for scheduled failure alert');
    return;
  }

  try {
    const message = {
      text: `🚨 PostMyStyle SCHEDULED UGC Monitor Failed`,
      attachments: [{
        color: 'danger',
        fields: [
          {
            title: 'Scheduled Execution Failed',
            value: `The scheduled UGC monitoring run failed at ${new Date().toISOString()}`,
            short: false
          },
          { title: 'Error Message', value: error.message, short: false },
          { title: 'Execution Time', value: `${executionTime}ms`, short: true },
          {
            title: 'Next Scheduled Run',
            value: 'In 2 hours (if system recovers)',
            short: true
          }
        ],
        footer: 'PostMyStyle UGC Monitor',
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    await axios.post(webhookUrl, message, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('📣 Scheduled failure alert sent');

  } catch (alertError) {
    console.error('❌ Failed to send scheduled failure alert:', alertError.message);
  }
}