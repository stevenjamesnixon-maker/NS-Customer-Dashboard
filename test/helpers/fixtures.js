'use strict';
/**
 * Fixture configuration and rows. The IDs are made up for the tests; they are not account IDs.
 */
var CFG = {
    WON_STATUSES: ['13'],
    LOST_STATUSES: ['14'],
    DESIGN_SUBSTATUS: ['1', '4', '5', '13'],
    NEEDINFO_SUBSTATUS: ['1'],
    DELIVERY_SUBSTATUS: ['8', '11'],
    EXCLUDED_STATUSES: ['90', '91'],
    EXCLUDED_QUOTE_TYPES: ['7', '8'],
    PE_VALUEPROPS: ['2', '3'],
    FALLBACK_EMPLOYEE: '500',
    PAY_BACS: '1',
    PAY_CARD: '2'
};

function opp(id, status, subStatus, extra) {
    var o = { id: id, tranId: 'OPP' + id, title: 'Project ' + id, siteAddress: '1 High St', status: status,
        subStatus: subStatus, salesRep: '', pe: '', valueProposition: '' };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

function order(id, opportunityId, extra) {
    var o = { id: id, tranId: 'SO' + id, opportunityId: opportunityId, recordStatus: '', quoteType: '1',
        quoteTypeText: 'Underfloor heating system', confirmedDateKey: '', payIntent: '', ready: false,
        holdReason: '', shipDateKey: '', timeText: '' };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

module.exports = { CFG: CFG, opp: opp, order: order };
