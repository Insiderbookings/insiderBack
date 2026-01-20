
import models, { sequelize } from './src/models/index.js';

const FLOW_ID = '2426941c-82df-4eb0-958b-7e7c86e94fe0';

(async () => {
    try {
        await sequelize.authenticate();

        console.log(`Checking flow: ${FLOW_ID}`);

        const steps = await models.BookingFlowStep.findAll({
            where: {
                flow_id: FLOW_ID
            },
            order: [['created_at', 'ASC']]
        });

        const getRoomsStep = steps.find(s => s.step === 'GETROOMS');
        if (getRoomsStep) {
            console.log('--- GETROOMS (SEARCH) ANALYSIS ---');
            const xml = getRoomsStep.request_xml || '';

            const adultsMatch = xml.match(/<adults>(\d+)<\/adults>/);
            const childrenMatch = xml.match(/<children>(\d+)<\/children>/);

            console.log(`Search Request Adults: ${adultsMatch ? adultsMatch[1] : 'NOT FOUND'}`);
            console.log(`Search Request Children: ${childrenMatch ? childrenMatch[1] : 'NOT FOUND'}`);

            const childAges = [];
            let match;
            const childRegex = /<child[^>]*>(.*?)<\/child>/g;
            while ((match = childRegex.exec(xml)) !== null) {
                childAges.push(match[1]);
            }
            if (childAges.length) {
                console.log(`Search Child Ages: ${childAges.join(', ')}`);
            }

            console.log('--- GETROOMS (RESPONSE) ANALYSIS ---');
            const respXml = getRoomsStep.response_xml || '';
            const adultAttr = respXml.match(/adults="(\d+)"/);
            const childAttr = respXml.match(/children="(\d+)"/);

            console.log(`Response Adults (attr): ${adultAttr ? adultAttr[1] : 'NOT FOUND'}`);
            console.log(`Response Children (attr): ${childAttr ? childAttr[1] : 'NOT FOUND'}`);

            // Check rateBases
            const rates = [];
            const rateRegex = /<rateBasis[^>]*id="([^"]+)"[^>]*>/g;
            let rMatch;
            let count = 0;
            while ((rMatch = rateRegex.exec(respXml)) !== null && count < 5) {
                rates.push(rMatch[1]);
                count++;
            }
            console.log(`First 5 RateBasis IDs: ${rates.join(', ')}`);

            if (respXml.includes('code="73692965"')) {
                console.log('Room 73692965 FOUND in response.');
                const roomChunk = respXml.split('code="73692965"')[1];
                if (roomChunk) {
                    const rateInRoom = roomChunk.match(/<rateBasis[^>]*id="([^"]+)"/);
                    console.log(`RateBasis ID for Room 73692965: ${rateInRoom ? rateInRoom[1] : 'NOT FOUND'}`);
                }
            }
        }

        const flow = await models.BookingFlow.findOne({ where: { id: FLOW_ID } });
        if (flow) {
            if (flow.search_context) {
                console.log('--- FLOW SEARCH CONTEXT ---');
                const rooms = flow.search_context.rooms || [];
                console.log(JSON.stringify(rooms, null, 2));
            }
            if (flow.selected_offer) {
                console.log('--- FLOW SELECTED OFFER ---');
                console.log(JSON.stringify(flow.selected_offer, null, 2));
            }
        }

        const saveStep = steps.find(s => s.step === 'SAVEBOOKING');

        if (saveStep && saveStep.request_xml) {
            console.log('--- SAVEBOOKING ANALYSIS ---');
            const xml = saveStep.request_xml;

            const extractTag = (tag) => {
                const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
                return match ? match[1] : 'NOT FOUND';
            };

            const extractChildrenNo = (xmlStr) => {
                const match = xmlStr.match(/<children[^>]*no="(\d+)"/);
                return match ? match[1] : '0';
            }
            const extractActualChildrenNo = (xmlStr) => {
                const match = xmlStr.match(/<actualChildren[^>]*no="(\d+)"/);
                return match ? match[1] : '0';
            }

            console.log(`adultsCode: ${extractTag('adultsCode')}`);
            console.log(`actualAdults: ${extractTag('actualAdults')}`);

            console.log(`children (no): ${extractChildrenNo(xml)}`);
            console.log(`actualChildren (no): ${extractActualChildrenNo(xml)}`);

            console.log(`salutation: ${extractTag('salutation')}`);

        } else {
            console.log('SAVEBOOKING step not found or missing XML.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
})();
