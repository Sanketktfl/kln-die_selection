import {Registry} from 'cs-web-components-base';
import {prefixNS} from './helpers';
import reducer from './reducers/reducers';
import MainComponent from './containers/MainComponent';

Registry.registerComponent(prefixNS('MainComponent'), MainComponent);
Registry.registerReducer(prefixNS('reducer'), reducer);

export default {
    MainComponent
};
